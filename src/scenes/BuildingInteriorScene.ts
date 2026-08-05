import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { keybindings } from '../core/Keybindings';
import { MOB_GRID_CELL_SIZE, TILE_SIZE } from '../core/constants';
import { GameMap, TOWER_INTERIOR_W } from '../map/GameMap';
import { BRAZIER, FIREPLACE } from '../map/tileTypes';
import { PlayerManager } from '../core/PlayerManager';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { PauseMenu } from '../ui/PauseMenu';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { ShopSystem } from '../systems/ShopSystem';
import { MobileHUDSystem } from '../systems/MobileHUDSystem';
import type { MobileHUDButton } from '../systems/MobileHUDSystem';
import { platform } from '../core/Platform';
import { TowerStairSystem } from '../systems/TowerStairSystem';
import {
  readMovement,
  applyMovement,
  triggerPlayerAttack,
  playMobAudioCues,
  KNOCKOUT_TIMEOUT_FRAMES,
} from '../systems/GameLoopPhases';
import { GameplayScene } from './GameplayScene';
import { pointInRect } from '../utils';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { AudioManager } from '../audio/AudioManager';
import {
  CLUB_MUSIC_TRACKS,
  DEFAULT_BUILDING_MUSIC_TRACKS,
  TAVERN_MUSIC_TRACKS,
  TOWER_MUSIC_TRACKS,
  type SoundId,
} from '../audio/sounds';
import { sfxGroupsForBuildingEntry } from '../audio/sfxGroups';
import { prewarmGroups } from '../core/SpriteLoader';
import { aiAdapter } from '../ai/AIAdapter';
import { drawText } from '../ui/TextBox';
import { EventBus } from '../core/EventBus';
import { FloatingCombatTextSystem } from '../systems/FloatingCombatTextSystem';
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { HotbarToast } from '../ui/HotbarToast';
import { potionEffectNotice, statBoostNotice } from '../ui/potionNotices';
import { POTION_EFFECT_SOUND_DELAY, TIMED_POTIONS } from '../core/timedPotions';
import { SkillBookPrompt } from '../ui/SkillBookPrompt';
import { RewardGrantedDialog } from '../ui/RewardGrantedDialog';
import { LevelUpDialog } from '../ui/LevelUpDialog';
import {
  promptSkillBookRead,
  resolveSkillBookPrompt,
  type SkillBookFlowHost,
} from '../systems/skillBookUse';
import { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { Townsperson } from '../creatures/Townsperson';
import { CONVERSATION_WALK_AWAY_TILES } from '../creatures/townInteraction';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import { adviceObjective, MordecaiAdvisor, type AdviceSnapshot } from '../systems/mordecaiAdvice';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { createDoomsdayProgress, type DoomsdayProgress } from '../core/DoomsdayProgress';
import { createClubMembership, type ClubMembership } from '../core/ClubMembership';
import { FollowerMenu } from '../systems/FollowerMenu';
import {
  CompanionSystem,
  createCompanionStanceState,
  type CompanionStanceState,
} from '../systems/CompanionSystem';
import { createMercenaryRoster, type MercenaryRoster } from '../core/MercenaryRoster';
import {
  createGodModeState,
  applyGodModeToPlayer,
  GOD_MODE_ABILITY_LEVEL,
  type GodModeState,
} from '../core/GodMode';
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
import { buildInnMenu, serveInn, INN_ROOM_KEY } from '../systems/townInn';
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
import type { ItemId } from '../core/ItemDefs';
import { interiorServiceFor } from '../systems/townServices';
import {
  createTownMemory,
  noteResidentTalk,
  residentTalkCount,
  type TownMemory,
} from '../core/TownMemory';
import { CitizenDialog } from '../ui/CitizenDialog';
import { FortuneTellerPanel, HEDGE_WITCH } from '../ui/FortuneTellerPanel';
import { ReadablePanel } from '../ui/ReadablePanel';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { SpellSystem } from '../systems/SpellSystem';
import { GoreSystem } from '../systems/GoreSystem';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { MobUpdateLoop } from '../systems/MobUpdateLoop';
import { BigTopBossSystem } from '../systems/BigTopBossSystem';
import { CultHideoutSystem } from '../systems/CultHideoutSystem';
import { QuillConfrontationSystem } from '../systems/QuillConfrontationSystem';
import { SoulCrystalSystem } from '../systems/SoulCrystalSystem';
import { DeathScreen } from '../ui/DeathScreen';
import { resolvePlayerAttacks, resolveKills, type CombatContext } from '../systems/CombatSystem';
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
 * tracks whether a key is currently *down*. `input.clear()` empties that set, so
 * a key the player is physically still holding reads as released — until the
 * browser's auto-repeat puts it back and the panel shuts itself the moment it
 * appeared.
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

const TOWER_FLOOR_COUNT = 4;
const MAX_TOWER_FLOOR_INDEX = 3;
const DEFAULT_MAP_FALLBACK_WIDTH = 18;
const COMPANION_FOLLOW_OVERRIDE_RATIO = 0.8;
const COMPANION_FOLLOW_NORMAL_RATIO = 1.5;
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
const EXIT_BTN_TEXT_Y = 16;
const EXIT_BTN_Y_OFFSET = 110;
const EXIT_BTN_GAP = 8;
/** Fraction of max HP both players are revived to after falling in an interior fight. */
const INTERIOR_REVIVE_HP_FRACTION = 0.5;
/** The Quill confrontation happens in the magistrate's office on the tower's top floor. */
const TOWER_CONFRONTATION_FLOOR = 3;
/** Fade-in for an interior's own music when the building is entered. */
const INTERIOR_MUSIC_FADE_IN_MS = 800;

/** A quest encounter that runs inside a building (Big Top boss, cult hideout, tower fight). */
interface InteriorEncounter {
  update(ctx: SystemContext): void;
  renderUI(ctx: CanvasRenderingContext2D): void;
  /** Death-screen message when the players fall during this encounter. */
  readonly defeatMessage: string;
}

/** The combat stack instantiated only for interiors hosting a quest encounter. */
interface InteriorCombat {
  bus: EventBus;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  spells: SpellSystem;
  gore: GoreSystem;
  bodyPartGore: BodyPartGoreSystem;
  mobLoop: MobUpdateLoop;
  deathScreen: DeathScreen;
  abilityManager: AbilityManager;
  encounter: InteriorEncounter;
  /** Tower floor the encounter lives on (0 for single-floor interiors) — combat only runs there. */
  floor: number;
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

  // Safe room (restaurant only)
  private readonly safeRoom: SafeRoomSystem | null;
  private readonly mordecaiAdvisor = new MordecaiAdvisor();
  /** Null outside a restaurant interior, which is the only safe-room building. */
  private readonly bopca: BopcaSystem | null;
  /**
   * A bus of this scene's own, purely so the Bopca's events reach `AudioManager`.
   *
   * The scene has no shared bus outside a live combat stack, and the alternative —
   * playing sounds from inside the system — is what `AudioManager.wireEvents`
   * exists to avoid.
   */
  private readonly bopcaBus: EventBus | null;
  /**
   * Skill unlocks reach the player anywhere indoors — a skill book can be used
   * in any building — so this pair is built unconditionally, unlike the combat
   * stack and the safe-room Bopca.
   */
  private readonly skillBus = new EventBus();
  private readonly hotbarToast = new HotbarToast();
  private readonly systemNotices: SystemNoticeSystem;
  /** The read-confirm prompt and the two award overlays a skill book can raise. */
  private readonly skillBookPrompt = new SkillBookPrompt();
  private readonly rewardGrantedDialog = new RewardGrantedDialog();
  private readonly levelUpDialog = new LevelUpDialog();
  /**
   * Scene-level, not part of the combat stack: a level-up or a Cockroach save can
   * happen in a building with no encounter, and an undrained label queue would
   * otherwise dump itself all at once the next time combat started.
   */
  private readonly floatingText = new FloatingCombatTextSystem();

  // Shop (store only)
  private readonly shop: ShopSystem | null;

  // Desperado Club (club only)
  private readonly clubMembership: ClubMembership;
  private readonly mercenaryRoster: MercenaryRoster;
  private readonly godModeState: GodModeState;
  private readonly club: DesperadoClubSystem | null;

  // Key handler cleanup
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  // Shared mobile HUD (buttons, panels, touch state)
  private readonly mobileHUD = new MobileHUDSystem();

  // Pause menu
  protected readonly pauseMenu = new PauseMenu();

  // Companion follow override (recall) — set when the player picks "Follow me".
  private isFollowOverride = false;

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

  // Quest-encounter combat stack (null in buildings without a live encounter)
  private combat: InteriorCombat | null;
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
  private pendingServiceTalk: { target: Townsperson; turn: number } | null = null;
  /** Frames left in which a freshly-opened interior modal ignores the interact key. */
  private modalGraceFrames = 0;
  /**
   * Whether the interact key has been observed genuinely released since the open
   * modal appeared. Nothing calls `input.clear()` while one of these panels is
   * up, so inside that window "not held" really does mean the key came up —
   * which makes this the edge trigger `isHeld` cannot be on its own.
   */
  private modalCloseArmed = false;
  /** Effect stings waiting out their beat behind a gulp. */
  private delayedSounds: Array<{ id: SoundId; framesLeft: number }> = [];
  private gameOver = false;
  /** Kept for encounters created after construction (the tower's top-floor fight). */
  private readonly encounterAbilityManager: AbilityManager | null;

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
    private readonly humanAchievements?: AchievementManager,
    private readonly catAchievements?: AchievementManager,
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
  ) {
    super(input, sceneManager);
    this.audio = audio ?? null;
    // Additive and cheap on repeat entry: preloading the same interior's SFX
    // group twice is a no-op, so re-entering a shop never re-pays the decode
    // cost (see the DungeonScene equivalent for the matching per-floor case).
    void this.audio?.preload(sfxGroupsForBuildingEntry(entry));
    this.pauseMenu.audio = this.audio;
    this.encounterAbilityManager = abilityManager ?? null;
    this.doomsdayProgress = doomsdayQuestProgress ?? createDoomsdayProgress();
    this.soulCrystal = new SoulCrystalSystem(this.doomsdayProgress, this.audio);
    this.clubMembership = clubMembership ?? createClubMembership();
    this.mercenaryRoster = mercenaryRoster ?? createMercenaryRoster();
    this.godModeState = godModeState ?? createGodModeState();
    this.companionStance = companionStance ?? createCompanionStanceState();

    const isTower = entry.type === 'tower';

    // prebuiltStructure skips dungeon generation entirely (mapSize 0 would
    // crash the generator); generateInterior() builds the real room next.
    if (isTower) {
      // Generate 4 tower floors
      for (let f = 0; f < TOWER_FLOOR_COUNT; f++) {
        const floorMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
        floorMap.generateInterior('tower', f, entry.name);
        this.towerFloors.push(floorMap);
      }
      this.map = this.towerFloors[0];
    } else {
      // Build single interior map
      this.map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
      this.map.generateInterior(entry.type, 0, entry.name);
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
    this.applyCheatOverlay();

    // Re-position after restore (restore doesn't set x/y).
    this.pm.setPositions(sx, sy);

    this.audio?.wireEvents(this.skillBus);
    this.systemNotices = new SystemNoticeSystem(this.skillBus, this.hotbarToast);
    this.skillBookPrompt.audio = this.audio;
    this.rewardGrantedDialog.audio = this.audio;
    this.levelUpDialog.audio = this.audio;

    // Companion command state holder + menu, sharing the overworld stance so
    // movement mode and combat stance are consistent everywhere. Used only as a
    // state store here (buildings drive the follow directly via
    // applyCompanionFollow), so its combat/pathing update is never ticked.
    this.companion = new CompanionSystem(this.map, sx, sy, this.companionStance);
    this.wireFollowerMenu();

    this.safeRoom =
      entry.type === 'restaurant'
        ? new SafeRoomSystem(this.map, sx, sy, 'level3', this.audio)
        : null;

    if (entry.type === 'restaurant') {
      const bopcaBus = new EventBus();
      this.audio?.wireEvents(bopcaBus);
      this.bopcaBus = bopcaBus;
      this.bopca = new BopcaSystem(this.map, stampSafeRoomCounters(this.map), bopcaBus, this.audio);
      // After the counter, because the furnishings keep clear of every tile it
      // owns and cannot know them until it is planned.
      stampSafeRoomDecor(this.map);
    } else {
      this.bopcaBus = null;
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

    this.combat = this.initEntryEncounter(abilityManager, this.circus?.progress);

    // Ambient occupants only where no live encounter owns the room; the tower's
    // confrontation can start after entry, so towers are excluded outright.
    this.occupants =
      this.combat === null
        ? InteriorOccupantSystem.forBuilding(this.map, entry.type, entry.name)
        : null;
    this.citizenDialog =
      this.occupants !== null && this.audio !== null ? new CitizenDialog(this.audio) : null;
    // Suppressed for the same reason occupants are: a room hosting a live quest
    // encounter is a fight, not a library.
    this.readables =
      this.combat === null
        ? InteriorReadableSystem.forBuilding(
            this.map,
            entry.name,
            this.occupants?.occupiedFurniture ?? new Set(),
          )
        : null;

    this.ambientSound =
      this.audio !== null ? new AmbientSoundSystem(this.audio, this.buildAmbientEmitters()) : null;

    this.townMemory = townMemory ?? createTownMemory();

    const service = interiorServiceFor(entry.name);
    this.servicePanel = service?.surface === 'menu' ? new PricedMenuPanel() : null;
    this.readingPanel = service?.surface === 'reading' ? new FortuneTellerPanel() : null;
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

  /**
   * Encounters that are live from the moment the building is entered: the
   * Big Top's Grimaldi fight and the Blackwood Lodge cult hideout. The
   * tower's Quill confrontation is created later, on reaching the top floor.
   */
  private initEntryEncounter(
    abilityManager: AbilityManager | undefined,
    circusProgress: CircusQuestProgress | undefined,
  ): InteriorCombat | null {
    if (!abilityManager) return null;

    if (this.entry.name === 'Big Top' && circusProgress?.stage === 'bigtop_ready') {
      return this.createCombatStack(abilityManager, this.map, 0, (bus, addMob) => {
        return new BigTopBossSystem(this.map, bus, addMob, circusProgress, this.audio);
      });
    }

    const murderProgress = this.murderQuestProgress;
    if (this.entry.name === 'Blackwood Lodge' && murderProgress?.stage === 'cult_hideout') {
      return this.createCombatStack(abilityManager, this.map, 0, (bus, addMob) => {
        return new CultHideoutSystem(this.map, bus, addMob, murderProgress, this.audio);
      });
    }

    return null;
  }

  /** Builds the shared interior combat stack around a quest encounter. */
  private createCombatStack(
    abilityManager: AbilityManager,
    map: GameMap,
    floor: number,
    makeEncounter: (bus: EventBus, addMob: (mob: Mob) => void) => InteriorEncounter,
  ): InteriorCombat {
    const bus = new EventBus();
    const mobs: Mob[] = [];
    const mobGrid = new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE);
    const spells = new SpellSystem();
    const gore = new GoreSystem();
    const bodyPartGore = new BodyPartGoreSystem(map);
    const deathScreen = new DeathScreen();
    deathScreen.audio = this.audio;

    const addMob = (mob: Mob): void => {
      mobs.push(mob);
      mobGrid.insert(mob);
      mob.setSpells(spells);
      mob.setMap(map);
    };

    bus.on('spawnGore', (e) => {
      gore.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });
    bus.on('mobKilled', (e) => {
      const cx = e.mob.x + TILE_SIZE * TILE_CENTER_RATIO;
      const cy = e.mob.y + TILE_SIZE * TILE_CENTER_RATIO;
      let impactDx = 0;
      let impactDy = 0;
      if (e.killer !== null) {
        const dx = cx - (e.killer.x + TILE_SIZE * TILE_CENTER_RATIO);
        const dy = cy - (e.killer.y + TILE_SIZE * TILE_CENTER_RATIO);
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          impactDx = dx / dist;
          impactDy = dy / dist;
        }
      }
      gore.spawnGore(cx, cy, impactDx, impactDy);
      bodyPartGore.spawnParts(cx, cy, e.mob.bodyPartKey, TILE_SIZE, impactDx, impactDy);
      this.audio?.playRandom(['splat_1', 'splat_2', 'splat_3']);
      // No floor-loot system indoors — drops go straight into the killer's purse and pack.
      if (e.killer !== null && e.mob.droppedLoot !== null) {
        e.killer.coins += e.mob.droppedLoot.coins;
        for (const item of e.mob.droppedLoot.items) {
          e.killer.inventory.addItem(item.id, item.quantity);
        }
        e.mob.droppedLoot = null;
      }
    });
    bus.on('playerLevelUp', () => {
      this.audio?.play('player_level_up');
    });

    const encounter = makeEncounter(bus, addMob);

    return {
      bus,
      mobs,
      mobGrid,
      spells,
      gore,
      bodyPartGore,
      mobLoop: new MobUpdateLoop(),
      deathScreen,
      abilityManager,
      encounter,
      floor,
    };
  }

  /**
   * The Quill confrontation spawns the first time the players reach the
   * tower's top floor while the murder quest is at its confrontation stage.
   */
  private maybeStartTowerConfrontation(): void {
    if (this.combat !== null) return;
    if (this.entry.type !== 'tower' || this.currentFloor !== TOWER_CONFRONTATION_FLOOR) return;
    const murderProgress = this.murderQuestProgress;
    if (murderProgress?.stage !== 'confrontation') return;
    if (!this.encounterAbilityManager) return;

    const floorMap = this.map;
    this.combat = this.createCombatStack(
      this.encounterAbilityManager,
      floorMap,
      TOWER_CONFRONTATION_FLOOR,
      (bus, addMob) => {
        return new QuillConfrontationSystem(
          floorMap,
          bus,
          addMob,
          murderProgress,
          this.audio,
          this.doomsdayProgress,
        );
      },
    );
  }

  private changeFloor(newFloor: number): void {
    if (newFloor < 0 || newFloor > MAX_TOWER_FLOOR_INDEX) return;
    const goingUp = newFloor > this.currentFloor;
    this.currentFloor = newFloor;
    this.map = this.towerFloors[newFloor];
    this.mapW = this.map.structure[0]?.length ?? TOWER_INTERIOR_W;
    this.cat.setMap(this.map);
    this.towerStairs?.setMap(this.map, newFloor);

    // Spawn at the opposite stair on the new floor:
    // if ascending, place at the down-stairs; if descending, place at the up-stairs
    const spawnTiles = goingUp ? this.map._interiorStairDownTiles : this.map._interiorStairUpTiles;
    const spawn = spawnTiles[0] ?? this.map.startTile;
    const spawnY = spawn.y + 1; // one tile below the stair so the menu doesn't re-trigger
    this.human.x = spawn.x * TILE_SIZE;
    this.human.y = spawnY * TILE_SIZE;
    this.cat.x = (spawn.x + 1) * TILE_SIZE;
    this.cat.y = spawnY * TILE_SIZE;

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
   * taverns, the tower's own theme, and a shared default in every other room.
   * Null where an entry encounter already started its own battle music.
   */
  private interiorMusicTracks(): ReadonlyArray<SoundId> | null {
    if (this.combat !== null) return null;
    if (this.entry.type === 'club') return CLUB_MUSIC_TRACKS;
    if (this.entry.type === 'tower') return TOWER_MUSIC_TRACKS;
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

    this.escHandler = (e: KeyboardEvent) => {
      const action = keybindings.actionFor(e.key);
      // Swallowed rather than acted on: the switch itself is polled from the
      // held-key set in `update`, and letting Tab through moves DOM focus off
      // the canvas.
      if (action === 'switchCharacter') {
        e.preventDefault();
        return;
      }
      if (action === 'toggleMiniMap' && !e.repeat) {
        e.preventDefault();
        this.mobileHUD.toggleMiniMap();
        return;
      }
      if (action === 'companionFollow' && !e.repeat) {
        e.preventDefault();
        if (!this.followerMenu.isOpen && this.canOpenFollowerMenu()) this.followerMenu.open();
        else if (this.followerMenu.isOpen) this.followerMenu.close();
        return;
      }
      if (this.bopca?.handleKeyDown(e.key) === true) {
        e.preventDefault();
        return;
      }
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (this.skillBookPrompt.isOpen) {
        // Escape declines the read; the book stays in the pack.
        this.skillBookPrompt.close();
        return;
      }
      if (this.followerMenu.isOpen) {
        this.followerMenu.close();
        return;
      }
      if (this.bopca?.dismissDialog() === true) {
        return;
      }
      if (this.safeRoom?.mordecaiDialogOpen) {
        this.safeRoom.mordecaiDialogOpen = false;
        return;
      }
      if (this.shop?.shopOpen) {
        this.shop.shopOpen = false;
        return;
      }
      if (this.club?.modalOpen) {
        this.club.closeModals(this.active());
        return;
      }
      if (this.servicePanel?.isOpen === true) {
        this.servicePanel.close();
        return;
      }
      if (this.readingPanel?.isOpen === true) {
        this.readingPanel.close();
        return;
      }
      if (this.readablePanel.isOpen) {
        this.readablePanel.close();
        return;
      }
      if (this.towerStairs?.menuOpen) {
        this.towerStairs.closeMenu();
        return;
      }
      if (this.exitMenuOpen) {
        this.exitMenuOpen = false;
        this.exitDismissed = true;
        return;
      }
      // Last before the pause menu: any box that can be raised over a live
      // conversation also renders over it, so the chat is the bottom-most thing
      // Escape can be aimed at.
      if (this.citizenDialog?.isOpen === true) {
        this.citizenDialog.close();
        // Escape is a refusal, not a page turn: a menu queued behind the story
        // must not open on the way out of it.
        this.pendingServiceTalk = null;
        this.releaseCitizenDialogTarget();
        return;
      }
      this.pauseMenu.toggle();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  onExit(): void {
    // Backstop for any teardown that does not route through `doExit`, which
    // closes the club's panels itself while the coins can still reach the
    // player. Idempotent, so running twice costs nothing.
    this.club?.closeAll(this.active());
    // Same contract as DungeonScene's bus: subscribers are re-wired per scene, so
    // the listeners this scene added must not outlive it.
    this.bopcaBus?.clear();
    this.skillBus.clear();
    this.hotbarToast.clear();
    this.floatingText.dispose();
    this.ambientSound?.dispose();
    this.bopca?.dispose();
    // Drops the pack-alert grid. It is a module-level handle, so an interior
    // that exited without this leaves its encounter's mobs — and through them
    // its map — reachable for the rest of the page's life.
    this.combat?.mobLoop.dispose();
    // Drop this scene's hit-rects so the next scene doesn't inherit stale hover.
    clearButtonMouseState();
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
  }

  /** True when no other modal owns the screen, so the follower menu may open. */
  private canOpenFollowerMenu(): boolean {
    return !(
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.exitMenuOpen ||
      this.towerStairs?.menuOpen === true ||
      this.safeRoom?.mordecaiDialogOpen === true ||
      this.safeRoom?.isSleeping === true ||
      this.bopca?.isDialogOpen === true ||
      this.shop?.shopOpen === true ||
      this.club?.modalOpen === true ||
      this.servicePanel?.isOpen === true ||
      this.readingPanel?.isOpen === true ||
      this.readablePanel.isOpen ||
      this.citizenDialog?.isOpen === true
    );
  }

  /** Hook the shared follower menu to the companion's commands (same set as the overworld). */
  private wireFollowerMenu(): void {
    this.followerMenu.onFollowMe = () => {
      this.audio?.play('menu_click');
      this.companion.setFollowMe(this.human.isActive);
      this.isFollowOverride = true;
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
   * True when the companion went down outside and was left lying there. They are
   * not in this building at all: they don't follow, don't render, and can't be
   * switched to — only walking back out reaches them.
   */
  private get companionLeftBehind(): boolean {
    return this.inactive().isKnockedOut;
  }

  /** The companion as a render-list fragment — empty when they were left outside. */
  private presentCompanion(): ReturnType<BuildingInteriorScene['inactive']>[] {
    return this.companionLeftBehind ? [] : [this.inactive()];
  }

  /** Hands control to the companion, unless they're lying knocked out outside. */
  private trySwitchActive(): void {
    if (this.companionLeftBehind) {
      this.audio?.play('error');
      return;
    }
    this.pm.switchActive();
  }

  /**
   * Keeps the left-behind companion's revive deadline running while the player is
   * indoors. Returns true once it has expired, which the overworld turns into a
   * game over as soon as the scene hands control back.
   */
  private tickCompanionLeftBehind(): boolean {
    const companion = this.inactive();
    if (!companion.isKnockedOut) return false;
    companion.isMoving = false;
    companion.knockedOutFrames++;
    return companion.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES;
  }

  update(): void {
    // The death screen accepts through its own focus ring now, which reaches
    // `handleClick` — nothing to poll for here.
    if (this.gameOver && this.combat) return;

    // Ticked unconditionally (any floor, any building) — the containment/
    // escape deadline must keep being checked wherever the players are.
    const isOnCrystalFloor =
      this.entry.type === 'tower' && this.currentFloor === TOWER_CONFRONTATION_FLOOR;
    this.soulCrystal.update(this.human, this.cat, this.active(), isOnCrystalFloor);
    if (this.soulCrystal.crystalContainedPending) {
      this.soulCrystal.crystalContainedPending = false;
      this.humanAchievements?.tryUnlock('doomsday_contained');
      this.catAchievements?.tryUnlock('doomsday_contained');
    }

    this.systemNotices.drainFor(this.human, this.cat);
    this.hotbarToast.update();
    this.floatingText.updateFor(this.human, this.cat);
    this.openPendingSkillBookPrompt();
    this.resolvePendingDrink();
    this.tickDelayedSounds();
    // Drained here rather than inside the panel branches that read it: a panel
    // dismissed with the mouse before the grace expired would otherwise leave a
    // stale count behind to swallow an unrelated key press later.
    if (this.modalGraceFrames > 0) this.modalGraceFrames--;
    this.rewardGrantedDialog.update();
    this.levelUpDialog.update();

    const reviveDeadlineExpired = this.tickCompanionLeftBehind();

    // A doomsday-timeout death outside an active boss encounter has no local
    // death screen to show (most buildings never construct one) — hand off
    // to the overworld immediately so DungeonScene's own death pipeline
    // picks it up with the correct cause/flavor text, instead of leaving the
    // player wandering around at 0 hp until they happen to exit on their own.
    // A companion who bleeds out on the doorstep takes the same route.
    const combatOnCurrentFloor = this.combat !== null && this.currentFloor === this.combat.floor;
    const someoneDiedOutright = this.pm.players().some((p) => !p.isAlive && !p.isKnockedOut);
    if (!combatOnCurrentFloor && (someoneDiedOutright || reviveDeadlineExpired)) {
      this.doExit();
      return;
    }

    if (this.skillBookPrompt.isOpen) return;
    // Both award dialogs accept through their own focus rings, which reach
    // `handleClick`; polling the key here would be the second path to the same
    // OK button.
    if (this.levelUpDialog.isShowing) return;
    if (this.rewardGrantedDialog.isShowing) return;
    if (this.pauseMenu.isOpen) return;
    if (this.followerMenu.isOpen) return;
    if (this.exitMenuOpen) return;
    if (this.towerStairs?.menuOpen) return;
    if (this.bopca?.isDialogOpen === true) {
      // The cook timer has to keep running through the conversation — the dish
      // is meant to land while the player is still reading the order line.
      this.bopca.tick(this.human, this.cat, this.active(), this.inactive());
      if (keybindings.isHeld(this.input, 'attack')) {
        this.input.clear();
        this.bopca.advanceDialog();
      }
      return;
    }
    if (this.safeRoom?.mordecaiDialogOpen) {
      this.safeRoom.tickDialog();
      if (keybindings.isHeld(this.input, 'attack')) {
        this.input.clear();
        this.safeRoom.advanceMordecaiDialog();
      }
      return;
    }
    if (this.shop?.shopOpen) return;
    if (this.club?.modalOpen) {
      // The blackjack table deals, flips and settles on its own clock, so it has
      // to keep ticking through its own panel — the same reason the Bopca's cook
      // timer runs through her dialog above.
      this.club.tickOpenModals(this.active());
      if (keybindings.isHeld(this.input, 'attack')) {
        this.input.clear();
        this.club.dismissModal(this.active());
      }
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
    if (conversationOpen) {
      this.citizenDialog.update();
      if (keybindings.isHeld(this.input, 'attack')) {
        this.input.clear();
        this.citizenDialog.advance();
      }
    }

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

    // Movement via shared GameLoopPhases
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
    const followDist = this.isFollowOverride
      ? TILE_SIZE * COMPANION_FOLLOW_OVERRIDE_RATIO
      : TILE_SIZE * COMPANION_FOLLOW_NORMAL_RATIO;
    // "Do not move" holds the companion in place; otherwise it trails the player.
    if (this.companionLeftBehind) {
      this.inactive().isMoving = false;
    } else if (this.companion.getMovementMode(this.human.isActive) === 'follow') {
      this.applyCompanionFollow(this.map, followDist);
    } else {
      this.inactive().isMoving = false;
    }

    // Held back mid-conversation to match the street: swapping characters would
    // hand the walk-away check a body standing several tiles back, closing the
    // box on a player who never moved.
    if (!conversationOpen && keybindings.isHeld(this.input, 'switchCharacter')) {
      this.input.clear();
      this.trySwitchActive();
    }

    // Safe room: sleep / talk to Mordecai. Only consume Space when actually
    // acting, so an unrelated press can still fall through to talking to an
    // ambient occupant sharing the room.
    if (
      this.bopca !== null &&
      keybindings.isHeld(this.input, 'attack') &&
      this.bopca.tryInteract(player)
    ) {
      this.input.clear();
    }

    if (this.safeRoom && keybindings.isHeld(this.input, 'attack')) {
      if (this.safeRoom.isNearBed(player)) {
        this.input.clear();
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        this.input.clear();
        this.talkToMordecai();
      }
    }

    // Store: toggle shop when near shopkeeper or close it with Space
    if (this.shop && keybindings.isHeld(this.input, 'attack')) {
      if (this.shop.shopOpen) {
        this.input.clear();
        this.shop.shopOpen = false;
      } else if (this.shop.isNearShopkeeper(player)) {
        this.input.clear();
        this.shop.shopOpen = true;
      }
    }

    // Club: talk to a station NPC (the Sledge, bar, casino, …) with Space.
    // Only consume when a station actually answered, so a press beside an
    // ambient occupant still reaches the conversation below.
    if (
      this.club !== null &&
      keybindings.isHeld(this.input, 'attack') &&
      this.club.handleInteract(player)
    ) {
      this.input.clear();
    }

    // Ambient occupants: talk to the nearest one with Space
    if (keybindings.isHeld(this.input, 'attack') && this.tryTalkToOccupant(player)) {
      this.input.clear();
    }

    // Readables sit on furniture the occupants stand beside, so this runs after
    // the talk above: a person in reach always wins the same press.
    //
    // The press is deliberately *not* cleared. Nothing below this reads it, the
    // panel's own early-return owns every frame after, and leaving the key alone
    // is what lets `consumeModalClose` see the player's real hold — a clear here
    // would fake a release and the page would shut on the first auto-repeat.
    if (keybindings.isHeld(this.input, 'attack')) this.tryReadNearby(player);

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();
    this.safeRoom?.updateWander();
    this.bopca?.tick(this.human, this.cat, player, this.inactive());
    this.shop?.update();
    this.club?.update(this.active(), this.presentCompanion()[0] ?? null);
    this.occupants?.update();
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

    // Combat only runs on the floor hosting the encounter — mobs on the
    // tower's top floor must not tick against another floor's map.
    if (this.currentFloor === this.combat?.floor) this.updateCombat();
  }

  private updateCombat(): void {
    const combat = this.combat;
    if (!combat) return;

    // Space attacks — encounter interiors have no safe room or shop competing for the key.
    if (keybindings.isHeld(this.input, 'attack')) {
      this.input.clear();
      triggerPlayerAttack(this.human, this.cat, combat.mobGrid, this.map, this.audio);
    }

    const active = this.active();
    const ctx: SystemContext = {
      human: this.human,
      cat: this.cat,
      active,
      inactive: this.inactive(),
      activeIsMoving: active.isMoving,
      mobs: combat.mobs,
      mobGrid: combat.mobGrid,
      gameMap: this.map,
    };

    this.human.updateAttack();
    this.cat.updateAttack();
    this.cat.updateMissiles(combat.mobGrid);

    combat.spells.update(ctx);
    combat.mobLoop.update(ctx);
    combat.encounter.update(ctx);
    playMobAudioCues(combat.mobs, this.audio);

    const combatCtx: CombatContext = {
      human: this.human,
      cat: this.cat,
      mobs: combat.mobs,
      mobGrid: combat.mobGrid,
      gameMap: this.map,
      safeRoom: null,
      bus: combat.bus,
      abilityManager: combat.abilityManager,
      spells: combat.spells,
      hitLanded: false,
      // No `xpDiminishingTiers`: interiors hang off the overworld, which declares
      // no curve. A floor that both declares one and hosts an interior encounter
      // would have to plumb its LevelDef through to here.
    };
    resolvePlayerAttacks(combatCtx);
    this.cat.flushPendingSubMissiles();
    resolveKills(combatCtx);

    combat.gore.update();
    combat.bodyPartGore.update();

    if (!active.isAlive) {
      this.gameOver = true;
      combat.deathScreen.activate(combat.encounter.defeatMessage);
    }
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
    if (this.gameOver && this.combat) {
      if (this.combat.deathScreen.handleClick(mx, my)) this.reviveAndExit();
      return;
    }
    if (this.levelUpDialog.handleClick(mx, my)) return;
    if (this.rewardGrantedDialog.handleClick(mx, my)) return;
    if (this.skillBookPrompt.isOpen) {
      resolveSkillBookPrompt(this.skillBookFlowHost(), this.active(), mx, my);
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
    // Pause button (works on desktop + mobile)
    const btn = this.mobileHUD.hitTest(mx, my);
    if (btn === 'pause') {
      this.pauseMenu.toggle();
      return;
    }
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
    if (this.citizenDialog?.isOpen === true) {
      this.citizenDialog.handleClick(mx, my);
      return;
    }
    if (!this.exitMenuOpen) return;
    const rects = this.menuRects();
    if (
      mx >= rects.exit.x &&
      mx <= rects.exit.x + rects.exit.w &&
      my >= rects.exit.y &&
      my <= rects.exit.y + rects.exit.h
    ) {
      this.doExit();
    } else if (
      mx >= rects.stay.x &&
      mx <= rects.stay.x + rects.stay.w &&
      my >= rects.stay.y &&
      my <= rects.stay.y + rects.stay.h
    ) {
      this.exitMenuOpen = false;
      this.exitDismissed = true;
    }
  }

  /**
   * True while a pausing overlay owns the screen. The bag is still drawn
   * underneath one, and the overlays' buttons sit right on top of its slots, so
   * every raw-pointer path has to stop here — otherwise a click on Read or
   * Cancel also lands on the slot beneath it and re-queues the prompt.
   */
  private get isOverlayBlockingPointer(): boolean {
    return (
      this.skillBookPrompt.isOpen ||
      this.levelUpDialog.isShowing ||
      this.rewardGrantedDialog.isShowing
    );
  }

  handleMouseDown(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = true;
    if (this.isOverlayBlockingPointer) return;
    this.mobileHUD.handleMouseDown(mx, my, this.active().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this.mobileHUD.handleMouseMove(mx, my, this.active().inventory);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = false;
    if (this.isOverlayBlockingPointer) return;
    this.mobileHUD.handleMouseUp(mx, my, this.active().inventory);
  }

  /**
   * `mouseup` only fires on the canvas, so a press that is released off it would
   * otherwise leave a button stuck in its held state forever.
   */
  handleMouseLeave(): void {
    this._mouseDown = false;
    clearButtonMouseState();
  }

  /**
   * Re-apply an active `!god` / `!tough` cheat to this scene's players. Incoming
   * snapshots are stripped of god-mode boosts on transition, so the overlay has
   * to be rebuilt here for the cheat to persist while inside the building.
   */
  private applyCheatOverlay(): void {
    if (this.godModeState.active) {
      applyGodModeToPlayer(this.human);
      applyGodModeToPlayer(this.cat);
      this.encounterAbilityManager?.setGodModeMinLevel(GOD_MODE_ABILITY_LEVEL);
    } else if (this.godModeState.toughActive) {
      for (const p of [this.human, this.cat]) {
        p.godMode = true;
        p.zeroDamage = true;
      }
    }
  }

  private doExit(defeated = false): void {
    // Before the snapshot, not after: `onExit` runs only once the replacement
    // scene has already been built from these snapshots, so a refund credited
    // there lands on a Player object that is about to be discarded. The
    // blackjack table debits chips the moment they hit the felt, so a teardown
    // under an open table would otherwise cost the player real coins.
    this.club?.closeAll(this.active());
    // God mode rides on top of base stats rather than being folded into them, so
    // snapshots are already clean and the overworld can re-apply its own overlay.
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    this.onExitCallback(humanSnap, catSnap, defeated);
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
    const sellsHere = target.role === interiorServiceFor(this.entry.name)?.role;
    const turn = this.turnFor(target);

    if (sellsHere && !this.hasUntoldLore(target)) {
      this.openService(turn, resident);
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
    this.pendingServiceTalk = sellsHere ? { target, turn } : null;
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
    this.openService(queued.turn, resident);
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
    this.input.clear();
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
   * Opens whatever this building's service NPC does — a priced menu almost
   * everywhere, a reading in Old Hilda's kitchen.
   */
  private openService(turn: number, resident: ResidentDef | null): void {
    if (this.readingPanel !== null) {
      this.readingPanel.openWith(this.townDialogContext(), HEDGE_WITCH);
      this.beginModalGrace();
      this.audio?.play('menu_open');
      return;
    }
    if (this.servicePanel === null) return;
    this.openServiceMenu(this.servicePanel, turn, residentHost(resident, turn));
    this.beginModalGrace();
    this.audio?.play('menu_open');
  }

  /**
   * Starts the window in which a newly-opened modal ignores the interact key.
   * Every path that opens one goes through here, including the ones whose caller
   * already calls `input.clear()` — that clear is exactly the protection this
   * mechanism exists because it does not provide.
   */
  private beginModalGrace(): void {
    this.modalGraceFrames = MODAL_REOPEN_GRACE_FRAMES;
    this.modalCloseArmed = false;
  }

  /**
   * Fill the service panel with whatever this building sells. Each builder returns
   * both the rows and the handler that performs the service, so the two can never
   * drift apart.
   */
  private openServiceMenu(panel: PricedMenuPanel, turn: number, host: ResidentHost | null): void {
    const party = [this.human, this.cat];
    // Every service confirms with the same purchase chime; the tavern layers its
    // pour underneath so a round sounds like a round.
    const never = (): boolean => false;
    const always = (): boolean => true;
    const confirmed = (
      handler: PricedPurchaseHandler,
      pours: (option: PricedOption) => boolean,
    ): PricedPurchaseHandler => {
      return (option, buyer) => {
        const result = handler(option, buyer);
        if (!result.ok) return result;
        if (pours(option)) this.audio?.play('ambient_pouring_a_drink');
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
      case "Signet's Ink":
        // Rebuilt per purchase, so inking one stat design marks the other stat
        // designs as spent — and the skill mark as spent independently of them.
        panel.open(() => buildTattooMenu(this.active(), turn, host), confirmed(inkTattoo, never));
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
              party,
              this.active(),
              turn,
              host,
              isTownInDanger(this.townDialogContext()),
            ),
          // A round off the kitchen board pours; a bed does not.
          confirmed(
            serveInn(this.entry.name, party, turn),
            (option) => option.key !== INN_ROOM_KEY,
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

    const humanEvents = this.humanAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
    const catEvents = this.catAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
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
    const complete = stage === 'grimaldi_slain' || stage === 'complete';
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
    if (
      this.pauseMenu.isOpen ||
      this.exitMenuOpen ||
      this.shop?.shopOpen === true ||
      this.servicePanel?.isOpen === true ||
      this.readingPanel?.isOpen === true ||
      this.readablePanel.isOpen ||
      this.safeRoom?.mordecaiDialogOpen === true ||
      this.safeRoom?.isSleeping === true
    ) {
      return;
    }
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
    const service = interiorServiceFor(this.entry.name);
    if (service?.role !== target.role) return TALK_PROMPT_LABEL;
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

  render(ctx: CanvasRenderingContext2D): void {
    const { x: camX, y: camY } = this.computeCamera(this.map);

    // Drive the shared Button module before anything draws a button: it clears
    // last frame's hit-rects and resolves hover/press for this one.
    setButtonAudio(this.audio);
    setButtonMouseState(this._mouseX, this._mouseY, this._mouseDown);

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

    const combatOnThisFloor = this.combat !== null && this.currentFloor === this.combat.floor;
    if (this.combat && combatOnThisFloor) {
      const combat = this.combat;
      combat.gore.renderPuddles(ctx, camX, camY);
      combat.bodyPartGore.renderSettled(ctx, camX, camY);

      this.renderSortedEntities(ctx, camX, camY, [
        ...combat.mobs.filter((m) => m.isAlive),
        ...this.presentCompanion(),
        this.active(),
        ...safeRoomFigures,
        ...(this.club?.sortedRenderables() ?? []),
      ]);

      combat.gore.renderParticles(ctx, camX, camY);
      combat.bodyPartGore.renderFlying(ctx, camX, camY);
      combat.spells.renderShell(ctx, camX, camY);
      combat.spells.renderCatMiniShell(ctx, camX, camY, this.cat);
      combat.spells.renderChainLightning(ctx, camX, camY);
      combat.spells.renderShockwaveRipples(ctx, camX, camY);
      combat.spells.renderFogs(ctx, camX, camY);
    } else {
      this.renderSortedEntities(ctx, camX, camY, [
        ...this.presentCompanion(),
        this.active(),
        ...(this.occupants?.people ?? []),
        ...safeRoomFigures,
        ...(this.club?.sortedRenderables() ?? []),
      ]);
      this.renderCitizenPrompt(ctx, camX, camY);
    }

    this.floatingText.render(ctx, camX, camY);

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

      const active = this.active();
      const name = this.human.isActive ? 'Human' : 'Cat';
      this.mobileHUD.renderPanels(ctx, active.inventory, name, active.coins);
      if (platform.isMobile) {
        const extraButtons: MobileHUDButton[] = [
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

    if (this.combat && combatOnThisFloor) this.combat.encounter.renderUI(ctx);
    this.soulCrystal.renderUI(ctx);

    if (this.exitMenuOpen) this.renderExitMenu(ctx);
    if (this.towerStairs?.menuOpen) this.towerStairs.renderMenu(ctx);

    this.hotbarToast.render(ctx, this.mobileHUD.inventoryPanel.hotbarBandHeight());
    this.levelUpDialog.render(ctx);
    this.rewardGrantedDialog.render(ctx);
    this.skillBookPrompt.render(ctx);

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.render(ctx, this.human, this.cat);
    }

    this.followerMenu.render(
      ctx,
      this.companion.getMovementMode(this.human.isActive),
      this.companion.getCombatStance(this.human.isActive),
      this.human.isActive,
    );

    if (this.gameOver && this.combat) {
      this.combat.deathScreen.render(ctx);
    }
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

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#0d1a09';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    drawText(ctx, '▼  Exit Building  ▼', {
      x: cw / 2,
      y: panelY + EXIT_MENU_TITLE_Y,
      size: 18,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    drawText(ctx, `Leave ${this.entry.name}?`, {
      x: cw / 2,
      y: panelY + EXIT_MENU_QUESTION_Y,
      size: 13,
      color: '#94a3b8',
      align: 'center',
    });

    drawText(ctx, '(Esc or Stay to remain inside)', {
      x: cw / 2,
      y: panelY + EXIT_MENU_HINT_Y,
      size: 11,
      color: '#64748b',
      align: 'center',
    });

    const rects = this.menuRects();

    ctx.fillStyle = '#1a4d0d';
    ctx.fillRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    drawText(ctx, 'Exit', {
      x: rects.exit.x + rects.exit.w / 2,
      y: rects.exit.y + EXIT_BTN_TEXT_Y,
      size: 14,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    drawText(ctx, 'Stay', {
      x: rects.stay.x + rects.stay.w / 2,
      y: rects.stay.y + EXIT_BTN_TEXT_Y,
      size: 14,
      bold: true,
      color: '#94a3b8',
      align: 'center',
    });

    ctx.textAlign = 'left';
  }

  private menuRects() {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
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

      // Route to click for modals
      if (
        this.pauseMenu.isOpen ||
        this.followerMenu.isOpen ||
        this.exitMenuOpen ||
        this.towerStairs?.menuOpen ||
        this.safeRoom?.mordecaiDialogOpen ||
        this.bopca?.isDialogOpen === true ||
        this.shop?.shopOpen ||
        this.club?.modalOpen ||
        this.servicePanel?.isOpen === true ||
        this.readingPanel?.isOpen === true ||
        this.readablePanel.isOpen ||
        this.skillBookPrompt.isOpen ||
        this.levelUpDialog.isShowing ||
        this.rewardGrantedDialog.isShowing
      ) {
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
      }

      // Mobile button hit-test (Switch, Gear, Bag, Pause, Minimap, Follow)
      if (platform.isMobile) {
        const btn = this.mobileHUD.hitTest(x, y);
        if (btn === 'switch') {
          this.trySwitchActive();
          continue;
        }
        if (btn === 'gear') {
          this.mobileHUD.gearPanel.toggle();
          continue;
        }
        if (btn === 'bag') {
          this.mobileHUD.inventoryPanel.toggle();
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
      //
      // No long-press context menu indoors, unlike the dungeon: this scene never
      // routes clicks to the inventory panel, so no option could ever be picked,
      // and Drop has nowhere to drop to in a building anyway. Reading a skill
      // book still works here through a plain tap and through the hotbar.
      const hi = this.mobileHUD.inventoryPanel.getHotbarTappedIndex(x, y);
      if (hi >= 0) {
        this.mobileHUD.inventoryDragTouchId = touch.identifier;
        this.handleMouseDown(x, y);
        continue;
      }

      // Inventory panel drag start
      if (this.mobileHUD.inventoryPanel.isOpen) {
        if (this.mobileHUD.inventoryPanel.hitsPanel(x, y)) {
          this.handleMouseDown(x, y);
          this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
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
        this.handleMouseUp(x, y);
        const hi = this.mobileHUD.inventoryPanel.getHotbarTappedIndex(x, y);
        // A second finger can land on the bar in the same frame an overlay goes
        // up; its release must resolve the overlay, not fire the slot beneath.
        if (hi >= 0 && !this.isOverlayBlockingPointer) {
          this.triggerHotbarActivation(hi);
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
            this.triggerTapInteractions(dialogWasOpen, bopcaWasOpen);
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
   */
  private triggerTapInteractions(dialogWasOpen: boolean, bopcaWasOpen: boolean): void {
    if (this.bopca !== null && !this.exitMenuOpen && !bopcaWasOpen) {
      this.bopca.tryInteract(this.active());
    }
    if (this.safeRoom && !this.exitMenuOpen) {
      const player = this.active();
      if (this.safeRoom.isNearBed(player)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        this.talkToMordecai();
      }
    }
    if (this.shop && !this.exitMenuOpen) {
      if (this.shop.isNearShopkeeper(this.active())) {
        this.shop.shopOpen = true;
      }
    }
    if (this.club && !this.exitMenuOpen && !this.club.modalOpen) {
      this.club.handleInteract(this.active());
    }
    // Talk to a nearby occupant only when nothing else claimed the tap: no
    // shop/club panel is up (the store has both a shop and shelf-browsers), and
    // the safe room didn't just sleep or open Mordecai (a restaurant has both
    // Mordecai/bed and ambient occupants within one tap's reach).
    if (
      !this.exitMenuOpen &&
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
      if (!this.tryTalkToOccupant(active)) this.tryReadNearby(active);
    }
  }

  private skillBookFlowHost(): SkillBookFlowHost {
    return {
      audio: this.audio,
      announce: (message) => this.hotbarToast.show(message),
      prompt: this.skillBookPrompt,
      // The drag is dropped alongside: the overlays' pointer guard blocks the
      // mouse-up that would otherwise resolve one still in flight.
      showReward: (reward) => {
        this.mobileHUD.inventoryPanel.interaction.cancelDrag();
        this.rewardGrantedDialog.enqueue(reward);
      },
      showLevelUp: (entry) => {
        this.mobileHUD.inventoryPanel.interaction.cancelDrag();
        this.levelUpDialog.enqueue(entry);
      },
      // Through toggle() rather than the flag, so the panel's own teardown runs.
      closeInventory: () => {
        if (this.mobileHUD.inventoryPanel.isOpen) this.mobileHUD.inventoryPanel.toggle();
      },
    };
  }

  /**
   * Drinks whatever the bag's context menu queued. Interiors resolve this
   * themselves because `DungeonScene` owns the dungeon's copy, and a player who
   * just bought a drink at the club bar reaches for it before walking outside.
   */
  private resolvePendingDrink(): void {
    const interaction = this.mobileHUD.inventoryPanel.interaction;
    const bottle = interaction.pendingDrinkSlot;
    if (bottle === null) return;
    interaction.pendingDrinkSlot = null;
    if (this.drinkFromSlot(bottle.id, bottle) && this.mobileHUD.inventoryPanel.isOpen) {
      this.mobileHUD.inventoryPanel.toggle();
    }
  }

  /**
   * Drinks one bottle from a slot, reporting whether it went down.
   *
   * Every drinkable is served, because two of the town's new counters sell
   * exactly the ones that used to be refused indoors — a Ruin-Root Tonic at the
   * apothecary and a Bag of Crisps at the mill are Jugg Juice and Cooldown
   * Crisps, and buzzing at a player who tries to drink what they just bought in
   * the shop they bought it in reads as a broken item.
   *
   * This is not `DungeonScene.drinkPotion`: that one also owns the tutorial
   * hooks, the potion cooldown and the `healingPotionUsed` event, none of which
   * exist in here. The timed-potion table is shared (`timedPotions.ts`) so the
   * two can never pour different drinks.
   */
  private drinkFromSlot(
    id: ItemId,
    bottle: { source: 'inv' | 'hotbar'; slotIdx: number },
  ): boolean {
    const active = this.active();
    const consume = (): boolean =>
      active.inventory.removeOneFromSlot(bottle.source, bottle.slotIdx, id);

    if (id === 'health_potion') {
      // `usePotion` gates on the cooldown and on being unhurt before it consumes,
      // so a refusal here has already cost nothing.
      if (!active.usePotion(consume)) {
        this.audio?.play('error_taking_action');
        return false;
      }
      // Played outright rather than through `healingPotionUsed`: that event is
      // wired to the audio manager on the *dungeon's* bus, so indoors a health
      // potion went down in silence.
      this.audio?.play('healing_potion');
      this.showDrinkNotice(id);
      return true;
    }
    if (id === 'dirty_shirley') {
      // A bottle that would change nothing is refused before it is opened: it
      // comes out of the bag rather than off a bar, so spending one for no
      // effect costs the player twice.
      if (!active.dirtyShirleyWouldHelp) {
        this.audio?.play('error_taking_action');
        return false;
      }
      if (!consume()) return false;
      active.drinkDirtyShirley();
      this.playDrinkSounds('healing_potion');
      this.showDrinkNotice(id);
      // The achievement is for drinking it where it is poured. Carrying one down
      // a floor and drinking it in a corridor is allowed; it just isn't this.
      if (this.entry.type === 'club') {
        this.humanAchievements?.tryUnlock('ask_for_it_dirty');
        this.catAchievements?.tryUnlock('ask_for_it_dirty');
      }
      return true;
    }
    if (id === 'stat_boost_potion') {
      if (!consume()) return false;
      const { stat, amount } = active.applyStatBoost();
      this.playDrinkSounds('stat_boost');
      this.hotbarToast.show(statBoostNotice(stat, amount));
      return true;
    }

    const timed = TIMED_POTIONS[id];
    if (timed === undefined) {
      this.audio?.play('error_taking_action');
      return false;
    }
    // Refusing rather than refreshing, exactly as the dungeon does: a second
    // bottle poured over a running one is coins for nothing.
    if (active.hasStatus(id) || !consume()) {
      this.audio?.play('error_taking_action');
      return false;
    }
    timed.activate(active);
    this.playDrinkSounds(timed.effectSound);
    this.showDrinkNotice(id);
    return true;
  }

  private tickDelayedSounds(): void {
    this.delayedSounds = this.delayedSounds.filter((pending) => {
      pending.framesLeft--;
      if (pending.framesLeft > 0) return true;
      this.audio?.play(pending.id);
      return false;
    });
  }

  /** The gulp, then the effect landing a beat later — the dungeon's pattern. */
  private playDrinkSounds(effectSound: SoundId): void {
    this.audio?.play('potion_drink');
    this.delayedSounds.push({ id: effectSound, framesLeft: POTION_EFFECT_SOUND_DELAY });
  }

  private showDrinkNotice(id: ItemId): void {
    const notice = potionEffectNotice(id);
    if (notice !== null) this.hotbarToast.show(notice);
  }

  private openPendingSkillBookPrompt(): void {
    const interaction = this.mobileHUD.inventoryPanel.interaction;
    const request = interaction.pendingSkillBookRead;
    if (request === null) return;
    interaction.pendingSkillBookRead = null;
    // The click that queued this also left a drag half-started on the slot
    // underneath the prompt about to cover it.
    interaction.cancelDrag();
    promptSkillBookRead(this.skillBookFlowHost(), this.active(), request);
  }

  private triggerHotbarActivation(hotbarIdx: number): void {
    const active = this.active();
    const slot = active.inventory.actionBar.slots[hotbarIdx];
    if (slot?.drinkable === true) {
      this.drinkFromSlot(slot.id, { source: 'hotbar', slotIdx: hotbarIdx });
      return;
    }
    if (slot?.skillId !== undefined) {
      // Queued rather than read outright: a skill book is spent for good, so
      // every route to one — hotbar key, hotbar tap, bag click — asks first.
      this.mobileHUD.inventoryPanel.interaction.pendingSkillBookRead = {
        bookId: slot.id,
        skillId: slot.skillId,
      };
    }
  }
}
