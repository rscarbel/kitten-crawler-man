import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { TILE_SIZE } from '../core/constants';
import { GameMap } from '../map/GameMap';
import { PlayerManager } from '../core/PlayerManager';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { PauseMenu } from '../ui/PauseMenu';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
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
} from '../systems/GameLoopPhases';
import { GameplayScene } from './GameplayScene';
import { pointInRect } from '../utils';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { AudioManager } from '../audio/AudioManager';
import { CLUB_MUSIC_TRACKS } from '../audio/sounds';
import { aiAdapter } from '../ai/AIAdapter';
import { drawText } from '../ui/TextBox';
import { EventBus } from '../core/EventBus';
import { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { createDoomsdayProgress, type DoomsdayProgress } from '../core/DoomsdayProgress';
import { createClubMembership, type ClubMembership } from '../core/ClubMembership';
import { createMercenaryRoster, type MercenaryRoster } from '../core/MercenaryRoster';
import {
  createGodModeState,
  applyGodModeToPlayer,
  GOD_MODE_ABILITY_LEVEL,
  stripGodModeFromSnapshot,
  type GodModeState,
} from '../core/GodMode';
import { DesperadoClubSystem } from '../systems/DesperadoClubSystem';
import { InteriorOccupantSystem } from '../systems/InteriorOccupantSystem';
import {
  buildCitizenConversation,
  roleDisplayName,
  type TownDialogContext,
} from '../systems/townDialog';
import { CitizenDialog } from '../ui/CitizenDialog';
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

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

const TOWER_FLOOR_COUNT = 4;
const MAX_TOWER_FLOOR_INDEX = 3;
const DEFAULT_MAP_FALLBACK_WIDTH = 18;
const TOWER_MAP_FALLBACK_WIDTH = 30;
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
const SPATIAL_GRID_CELL_SIZE_MULTIPLIER = 4;
/** Fraction of max HP both players are revived to after falling in an interior fight. */
const INTERIOR_REVIVE_HP_FRACTION = 0.5;
/** The Quill confrontation happens in the magistrate's office on the tower's top floor. */
const TOWER_CONFRONTATION_FLOOR = 3;
/** Fade-in for the Desperado Club's music when the interior is entered. */
const CLUB_MUSIC_FADE_IN_MS = 800;

/** A quest encounter that runs inside a building (Big Top boss, cult hideout, tower fight). */
interface InteriorEncounter {
  update(ctx: SystemContext): void;
  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void;
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

export class BuildingInteriorScene extends GameplayScene {
  private map: GameMap;
  readonly pm: PlayerManager;
  private mapW: number;

  // Exit menu state
  private onExitTile = false;
  private exitMenuOpen = false;
  private exitDismissed = false;

  // Safe room (restaurant only)
  private readonly safeRoom: SafeRoomSystem | null;

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

  // Companion follow override (mobile follow button)
  private isFollowOverride = false;

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
  // Talk surface for ambient occupants; null when there are no occupants or no audio.
  private readonly citizenDialog: CitizenDialog | null;
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
    private readonly onExitCallback: (humanSnap: PlayerSnapshot, catSnap: PlayerSnapshot) => void,
    private readonly humanAchievements?: AchievementManager,
    private readonly catAchievements?: AchievementManager,
    audio?: AudioManager,
    abilityManager?: AbilityManager,
    private readonly circusQuestProgress?: CircusQuestProgress,
    private readonly murderQuestProgress?: MurderQuestProgress,
    doomsdayQuestProgress?: DoomsdayProgress,
    clubMembership?: ClubMembership,
    mercenaryRoster?: MercenaryRoster,
    godModeState?: GodModeState,
  ) {
    super(input, sceneManager);
    this.audio = audio ?? null;
    this.pauseMenu.audio = this.audio;
    this.encounterAbilityManager = abilityManager ?? null;
    this.doomsdayProgress = doomsdayQuestProgress ?? createDoomsdayProgress();
    this.soulCrystal = new SoulCrystalSystem(this.doomsdayProgress, this.audio);
    this.clubMembership = clubMembership ?? createClubMembership();
    this.mercenaryRoster = mercenaryRoster ?? createMercenaryRoster();
    this.godModeState = godModeState ?? createGodModeState();

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

    const { x: sx, y: sy } = this.map.startTile;
    this.pm = new PlayerManager(sx, sy);
    this.cat.setMap(this.map);

    restorePlayer(this.human, humanSnap);
    restorePlayer(this.cat, catSnap);
    this.applyCheatOverlay();

    // Re-position after restore (restore doesn't set x/y).
    this.pm.setPositions(sx, sy);

    this.safeRoom =
      entry.type === 'restaurant'
        ? new SafeRoomSystem(this.map, sx, sy, 'level3', this.audio)
        : null;

    this.shop = entry.type === 'store' ? new ShopSystem(this.mapW) : null;

    this.club =
      entry.type === 'club'
        ? new DesperadoClubSystem(
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

    this.combat = this.initEntryEncounter(abilityManager, circusQuestProgress);

    // Ambient occupants only where no live encounter owns the room; the tower's
    // confrontation can start after entry, so towers are excluded outright.
    this.occupants =
      this.combat === null
        ? InteriorOccupantSystem.forBuilding(this.map, entry.type, entry.name)
        : null;
    this.citizenDialog =
      this.occupants !== null && this.audio !== null ? new CitizenDialog(this.audio) : null;
  }

  /**
   * Encounters that are live from the moment the building is entered: the
   * Big Top's Grimaldi fight and the Blackwood Barracks cult hideout. The
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
    if (this.entry.name === 'Blackwood Barracks' && murderProgress?.stage === 'cult_hideout') {
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
    const mobGrid = new SpatialGrid<Mob>(TILE_SIZE * SPATIAL_GRID_CELL_SIZE_MULTIPLIER);
    const spells = new SpellSystem();
    const gore = new GoreSystem();
    const bodyPartGore = new BodyPartGoreSystem();
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
      // No floor-loot system indoors — coin drops go straight to the killer.
      if (e.killer !== null && e.mob.droppedLoot !== null) {
        e.killer.coins += e.mob.droppedLoot.coins;
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
    this.mapW = this.map.structure[0]?.length ?? TOWER_MAP_FALLBACK_WIDTH;
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

    this.maybeStartTowerConfrontation();
  }

  onEnter(): void {
    // Override the overworld's persisted music with the club's own theme; the
    // overworld's zone music (OverworldMusicSystem) restores itself on exit.
    if (this.entry.type === 'club') {
      this.audio?.playMusicPlaylist(CLUB_MUSIC_TRACKS, { fadeInMs: CLUB_MUSIC_FADE_IN_MS });
    }

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }
      if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        e.preventDefault();
        this.mobileHUD.toggleMiniMap();
        return;
      }
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (this.safeRoom?.mordecaiDialogOpen) {
        this.safeRoom.mordecaiDialogOpen = false;
        return;
      }
      if (this.shop?.shopOpen) {
        this.shop.shopOpen = false;
        return;
      }
      if (this.club?.modalOpen) {
        this.club.closeModals();
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
      this.pauseMenu.toggle();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  onExit(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
  }

  update(): void {
    if (this.gameOver && this.combat) {
      if (this.input.has(' ')) {
        this.input.clear();
        if (this.combat.deathScreen.handleSpaceBar()) this.reviveAndExit();
      }
      return;
    }

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

    // A doomsday-timeout death outside an active boss encounter has no local
    // death screen to show (most buildings never construct one) — hand off
    // to the overworld immediately so DungeonScene's own death pipeline
    // picks it up with the correct cause/flavor text, instead of leaving the
    // player wandering around at 0 hp until they happen to exit on their own.
    const combatOnCurrentFloor = this.combat !== null && this.currentFloor === this.combat.floor;
    if (!combatOnCurrentFloor && (!this.human.isAlive || !this.cat.isAlive)) {
      this.doExit();
      return;
    }

    if (this.pauseMenu.isOpen) return;
    if (this.exitMenuOpen) return;
    if (this.towerStairs?.menuOpen) return;
    if (this.safeRoom?.mordecaiDialogOpen) {
      this.safeRoom.tickDialog();
      if (this.input.has(' ')) {
        this.input.clear();
        this.safeRoom.advanceMordecaiDialog();
      }
      return;
    }
    if (this.shop?.shopOpen) return;
    if (this.club?.modalOpen) {
      if (this.input.has(' ')) {
        this.input.clear();
        this.club.dismissModal();
      }
      return;
    }
    if (this.citizenDialog?.isOpen === true) {
      this.citizenDialog.update();
      if (this.input.has(' ')) {
        this.input.clear();
        this.citizenDialog.advance();
      }
      return;
    }

    // Sleep tick
    if (this.safeRoom?.isSleeping) {
      this.safeRoom.updateSleep(this.human, this.cat);
      this.safeRoom.updateWander();
      this.human.tickTimers();
      this.cat.tickTimers();
      return;
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
    applyMovement(player, move, this.map);
    const followDist = this.isFollowOverride
      ? TILE_SIZE * COMPANION_FOLLOW_OVERRIDE_RATIO
      : TILE_SIZE * COMPANION_FOLLOW_NORMAL_RATIO;
    this.applyCompanionFollow(this.map, followDist);

    // Tab: switch active player
    if (this.input.has('Tab')) {
      this.input.clear();
      this.pm.switchActive();
    }

    // Safe room: sleep / talk to Mordecai. Only consume Space when actually
    // acting, so an unrelated press can still fall through to talking to an
    // ambient occupant sharing the room.
    if (this.safeRoom && this.input.has(' ')) {
      if (this.safeRoom.isNearBed(player)) {
        this.input.clear();
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        this.input.clear();
        const humanEvents = this.humanAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
        const catEvents = this.catAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
        const merged = [...humanEvents, ...catEvents]
          .sort((a, b) => a.secondsAgo - b.secondsAgo)
          .slice(0, RECENT_EVENTS_LIMIT);
        const responsePromise = aiAdapter.chatWithMordecai({
          recentEvents: merged,
          humanLevel: this.human.level,
          catLevel: this.cat.level,
        });
        this.safeRoom.openMordecaiDialog(responsePromise);
      }
    }

    // Store: toggle shop when near shopkeeper or close it with Space
    if (this.shop && this.input.has(' ')) {
      if (this.shop.shopOpen) {
        this.input.clear();
        this.shop.shopOpen = false;
      } else if (this.shop.isNearShopkeeper(player)) {
        this.input.clear();
        this.shop.shopOpen = true;
      }
    }

    // Club: talk to a station NPC (the Sledge, bar, casino, …) with Space
    if (this.club && this.input.has(' ')) {
      this.input.clear();
      this.club.handleInteract(player);
    }

    // Ambient occupants: talk to the nearest one with Space
    if (this.citizenDialog !== null && this.occupants !== null && this.input.has(' ')) {
      const target = this.occupants.findTalkTarget(player.x, player.y);
      if (target !== null) {
        this.input.clear();
        target.faceToward(player.x, player.y);
        this.citizenDialog.open(
          roleDisplayName(target.role),
          buildCitizenConversation(
            target.role,
            target.appearance.seed,
            target.conversationCount,
            this.townDialogContext(),
          ),
        );
        target.conversationCount++;
      }
    }

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();
    this.safeRoom?.updateWander();
    this.shop?.update();
    this.club?.update();
    this.occupants?.update();
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
    if (this.input.has(' ')) {
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
    this.cat.updateMissiles(combat.mobs);

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

  /** Death inside an encounter: patch both crawlers up and put them back outside; the fight resets on re-entry. */
  private reviveAndExit(): void {
    for (const player of [this.human, this.cat]) {
      player.hp = Math.max(player.hp, Math.ceil(player.maxHp * INTERIOR_REVIVE_HP_FRACTION));
    }
    this.gameOver = false;
    this.doExit();
  }

  handleClick(mx: number, my: number): void {
    if (this.gameOver && this.combat) {
      if (this.combat.deathScreen.handleClick(mx, my)) this.reviveAndExit();
      return;
    }
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }
    // Pause button (works on desktop + mobile)
    const btn = this.mobileHUD.hitTest(mx, my);
    if (btn === 'pause') {
      this.pauseMenu.toggle();
      return;
    }
    if (this.towerStairs?.menuOpen) {
      this.towerStairs.handleClick(mx, my, this.sceneManager.canvas);
      return;
    }
    if (this.shop?.shopOpen) {
      this.shop.handleClick(mx, my, this.active());
      return;
    }
    if (this.club?.modalOpen) {
      this.club.handleClick(mx, my, this.active());
      return;
    }
    if (this.citizenDialog?.isOpen === true) {
      this.citizenDialog.handleClick(mx, my, this.sceneManager.canvas);
      return;
    }
    if (!this.exitMenuOpen) return;
    const canvas = this.sceneManager.canvas;
    const rects = this.menuRects(canvas);
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

  handleMouseDown(mx: number, my: number): void {
    this.mobileHUD.handleMouseDown(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this.mobileHUD.handleMouseMove(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleMouseUp(mx: number, my: number): void {
    this.mobileHUD.handleMouseUp(mx, my, this.sceneManager.canvas, this.active().inventory);
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

  private doExit(): void {
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    // The overworld scene re-applies god mode from the shared state, so hand it
    // clean stats rather than boosts baked in on top of the overlay it will add.
    if (this.godModeState.active) {
      stripGodModeFromSnapshot(humanSnap);
      stripGodModeFromSnapshot(catSnap);
    }
    this.onExitCallback(humanSnap, catSnap);
  }

  private townDialogContext(): TownDialogContext {
    const circus = this.circusQuestProgress;
    const murder = this.murderQuestProgress;
    return {
      circus: circus?.stage ?? 'not_started',
      murder: murder?.stage ?? 'not_started',
      doomsday: this.doomsdayProgress.stage,
      heatherSlain: circus?.heatherSlain ?? false,
      quillNamed: murder?.quillNamed ?? false,
    };
  }

  /** Floats a "Talk" prompt over the nearest occupant when one is in range. */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.citizenDialog === null || this.occupants === null) return;
    if (this.citizenDialog.isOpen) return;
    if (
      this.pauseMenu.isOpen ||
      this.exitMenuOpen ||
      this.shop?.shopOpen === true ||
      this.safeRoom?.mordecaiDialogOpen === true ||
      this.safeRoom?.isSleeping === true
    ) {
      return;
    }
    const active = this.active();
    const target = this.occupants.findTalkTarget(active.x, active.y);
    if (target === null) return;
    drawInteractionPrompt(ctx, target.x - camX, target.y - camY, TILE_SIZE, 'Talk');
  }

  render(ctx: CanvasRenderingContext2D): void {
    const canvas = this.sceneManager.canvas;
    const { x: camX, y: camY } = this.computeCamera(this.map);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.map.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);

    const combatOnThisFloor = this.combat !== null && this.currentFloor === this.combat.floor;
    if (this.combat && combatOnThisFloor) {
      const combat = this.combat;
      combat.gore.renderPuddles(ctx, camX, camY);
      combat.bodyPartGore.renderSettled(ctx, camX, camY);

      const entities: Array<{
        y: number;
        render(c: CanvasRenderingContext2D, cx: number, cy: number, ts: number): void;
      }> = [...combat.mobs.filter((m) => m.isAlive), this.inactive(), this.active()];
      entities.sort((a, b) => a.y - b.y);
      for (const entity of entities) entity.render(ctx, camX, camY, TILE_SIZE);

      combat.gore.renderParticles(ctx, camX, camY);
      combat.bodyPartGore.renderFlying(ctx, camX, camY);
      combat.spells.renderShell(ctx, camX, camY);
      combat.spells.renderCatMiniShell(ctx, camX, camY, this.cat);
      combat.spells.renderChainLightning(ctx, camX, camY);
      combat.spells.renderShockwaveRipples(ctx, camX, camY);
      combat.spells.renderFogs(ctx, camX, camY);
    } else {
      const entities: Array<{
        y: number;
        render(c: CanvasRenderingContext2D, cx: number, cy: number, ts: number): void;
      }> = [this.inactive(), this.active(), ...(this.occupants?.people ?? [])];
      entities.sort((a, b) => a.y - b.y);
      for (const entity of entities) entity.render(ctx, camX, camY, TILE_SIZE);
      this.renderCitizenPrompt(ctx, camX, camY);
    }

    // Independent of `combat` — the crystal must still be visible/containable
    // if the player returns to this floor after the encounter was torn down.
    const isOnCrystalFloor =
      this.entry.type === 'tower' && this.currentFloor === TOWER_CONFRONTATION_FLOOR;
    this.soulCrystal.render(ctx, camX, camY, this.active(), isOnCrystalFloor);

    if (this.safeRoom) {
      const pulse =
        SAFE_ROOM_PULSE_BASE + Math.sin(Date.now() / SAFE_ROOM_PULSE_PERIOD_MS) * PULSE_SWING;
      this.safeRoom.renderObjects(ctx, camX, camY, this.active(), pulse);
    }

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

    this.renderHUD(ctx, canvas);

    // Interior label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, INTERIOR_LABEL_BAR_HEIGHT);
    const floorSuffix = this.towerFloors.length > 0 ? ` (${FLOOR_LABELS[this.currentFloor]})` : '';
    drawText(ctx, `Inside: ${this.entry.name}${floorSuffix}`, {
      x: canvas.width / 2,
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
        canvas,
        this.map,
        this.active(),
        this.inactive(),
      );
      const pauseY = INTERIOR_TOP_MARGIN + mmSize + MM_TO_PAUSE_BTN_SPACING;
      this.mobileHUD.renderPauseButton(ctx, canvas, pauseY);
      const gearY = pauseY + GEAR_BTN_SPACING;

      const active = this.active();
      const name = this.human.isActive ? 'Human' : 'Cat';
      this.mobileHUD.renderPanels(ctx, canvas, active.inventory, name, active.coins);
      if (platform.isMobile) {
        const extraButtons: MobileHUDButton[] = [
          {
            id: 'follow',
            icon: '↩',
            label: 'Follow',
            active: this.isFollowOverride,
          },
        ];
        this.mobileHUD.renderButtons(
          ctx,
          canvas,
          this.human.isActive,
          extraButtons,
          MOBILE_BUTTONS_EXTRA_Y,
          gearY,
        );
      }
    }

    if (this.safeRoom) {
      this.safeRoom.renderUI(ctx, canvas, camX, camY, this.active());
      if (this.safeRoom.mordecaiDialogOpen) this.safeRoom.renderMordecaiDialog(ctx, canvas);
      if (this.safeRoom.isSleeping) this.safeRoom.renderSleepOverlay(ctx, canvas);
    }

    if (this.shop) {
      this.shop.renderUI(ctx, canvas, this.active());
      this.shop.renderShopPanel(ctx, canvas, this.active());
    }

    if (this.club) {
      this.club.renderUI(ctx, canvas, this.active());
    }

    this.citizenDialog?.render(ctx, canvas);

    if (this.combat && combatOnThisFloor) this.combat.encounter.renderUI(ctx, canvas);
    this.soulCrystal.renderUI(ctx, canvas);

    if (this.exitMenuOpen) this.renderExitMenu(ctx, canvas);
    if (this.towerStairs?.menuOpen) this.towerStairs.renderMenu(ctx, canvas);

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.render(ctx, canvas, this.human, this.cat);
    }

    if (this.gameOver && this.combat) {
      this.combat.deathScreen.render(ctx, canvas);
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

  private renderExitMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;

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

    const rects = this.menuRects(canvas);

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

  private menuRects(canvas: HTMLCanvasElement) {
    const cw = canvas.width;
    const ch = canvas.height;
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
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Route to click for modals
      if (
        this.pauseMenu.isOpen ||
        this.exitMenuOpen ||
        this.towerStairs?.menuOpen ||
        this.safeRoom?.mordecaiDialogOpen ||
        this.shop?.shopOpen ||
        this.club?.modalOpen
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
          this.human.isActive = !this.human.isActive;
          this.cat.isActive = !this.cat.isActive;
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
          this.isFollowOverride = !this.isFollowOverride;
          continue;
        }
      }

      // Hotbar slot tap — defer activation until touch end so long-press opens context menu
      const hi = this.mobileHUD.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
      if (hi >= 0) {
        this.mobileHUD.inventoryDragTouchId = touch.identifier;
        this.handleMouseDown(x, y);
        this.mobileHUD.startInvLongPress(x, y, () => {
          this.mobileHUD.inventoryPanel.openContextMenu(x, y, canvas, this.active().inventory);
        });
        continue;
      }

      // Inventory panel drag start + long-press for context menu
      if (this.mobileHUD.inventoryPanel.isOpen) {
        if (this.mobileHUD.inventoryPanel.hitsPanel(x, y, canvas)) {
          this.handleMouseDown(x, y);
          this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
          this.mobileHUD.startInvLongPress(x, y, () => {
            this.mobileHUD.inventoryPanel.openContextMenu(x, y, canvas, this.active().inventory);
          });
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

      // Cancel long-press if finger moved too far
      this.mobileHUD.checkInvLongPressMove(x, y);

      // Update inventory drag
      this.handleMouseMove(x, y);

      // Update movement target
      if (touch.identifier === this.mobileHUD.moveTouchId) {
        this.mobileHUD.moveTarget = { x, y };
      }
    }
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Inventory / hotbar drag end
      if (touch.identifier === this.mobileHUD.inventoryDragTouchId) {
        const longPressFired = this.mobileHUD.invLongPressFired;
        this.mobileHUD.clearInvLongPress();
        if (!longPressFired) {
          this.handleMouseUp(x, y);
          const hi = this.mobileHUD.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
          if (hi >= 0) {
            this.triggerHotbarActivation(hi);
          } else {
            this.handleClick(x, y);
          }
        }
        this.mobileHUD.inventoryDragTouchId = null;
        continue;
      }

      // Game world touch end
      if (touch.identifier === this.mobileHUD.moveTouchId) {
        if (this.mobileHUD.isTap(x, y)) {
          this.handleClick(x, y);
          // Trigger space-equivalent actions
          if (this.safeRoom && !this.exitMenuOpen) {
            const player = this.active();
            if (this.safeRoom.isNearBed(player)) {
              this.safeRoom.startSleep();
            } else if (this.safeRoom.isNearMordecai(player)) {
              const humanEvents =
                this.humanAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
              const catEvents = this.catAchievements?.getTopRecentEvents(RECENT_EVENTS_LIMIT) ?? [];
              const merged = [...humanEvents, ...catEvents]
                .sort((a, b) => a.secondsAgo - b.secondsAgo)
                .slice(0, RECENT_EVENTS_LIMIT);
              const responsePromise = aiAdapter.chatWithMordecai({
                recentEvents: merged,
                humanLevel: this.human.level,
                catLevel: this.cat.level,
              });
              this.safeRoom.openMordecaiDialog(responsePromise);
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
        }
        this.mobileHUD.clearMovement();
      }
    }
  }

  private triggerHotbarActivation(hotbarIdx: number): void {
    const active = this.active();
    const slot = active.inventory.actionBar.slots[hotbarIdx];
    if (slot?.id === 'health_potion') {
      active.usePotion();
    }
  }
}
