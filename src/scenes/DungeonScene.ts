import { SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import { IS_MOBILE } from '../core/MobileDetect';
import { TILE_SIZE } from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import { PlayerManager } from '../core/PlayerManager';
import { MobileTouchState } from '../core/MobileTouchState';
import type { LevelDef } from '../levels/types';
import { spawnForLevel, createMob } from '../levels/spawner';
import { getLevelDef } from '../levels';
import { PauseMenu } from '../ui/PauseMenu';
import { DeathScreen } from '../ui/DeathScreen';
import { AchievementManager } from '../core/AchievementManager';
import type { AchievementDef } from '../core/AchievementManager';
import { LootBoxOpener } from '../ui/LootBoxOpener';
import { AchievementNotification } from '../ui/AchievementNotification';
import { InventoryPanel } from '../ui/InventoryPanel';
import { GearPanel } from '../ui/GearPanel';
import { SpatialGrid } from '../core/SpatialGrid';

// Systems
import { MiniMapSystem } from '../systems/MiniMapSystem';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BossRoomSystem, BOSS_META } from '../systems/BossRoomSystem';
import { DynamiteSystem } from '../systems/DynamiteSystem';
import { SpellSystem } from '../systems/SpellSystem';
import { CompanionSystem } from '../systems/CompanionSystem';
import { LootSystem } from '../systems/LootSystem';
import { StairwellSystem } from '../systems/StairwellSystem';
import { BuildingSystem } from '../systems/BuildingSystem';
import { JuicerRoomSystem } from '../systems/JuicerRoomSystem';
import { BarrierSystem } from '../systems/BarrierSystem';
import { Juicer } from '../creatures/Juicer';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { Tuskling } from '../creatures/Tuskling';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { BossIntroSystem } from '../systems/BossIntroSystem';
import { resolvePlayerAttacks, resolveKills, type CombatContext } from '../systems/CombatSystem';
import { GoreSystem } from '../systems/GoreSystem';
import { EventBus } from '../core/EventBus';
import { PlayerTickSystem } from '../systems/PlayerTickSystem';
import { readMovement, applyMovement, checkDeath, revealMinimap } from '../systems/GameLoopPhases';
import { resolvePendingInventoryAction } from '../systems/InventoryActionSystem';
import { BuildingInteriorScene } from './BuildingInteriorScene';
import { MongoSystem } from '../systems/MongoSystem';
import { RenderPipeline, type RenderContext } from '../systems/RenderPipeline';
import { MobUpdateLoop } from '../systems/MobUpdateLoop';
import { DungeonInputHandler } from '../systems/DungeonInputHandler';
import { GameplayScene } from './GameplayScene';
import { KrakarenClone } from '../creatures/KrakarenClone';

export interface DungeonSceneOptions {
  /** Tile coordinates to spawn players at (instead of map start tile). */
  spawnAt?: { x: number; y: number };
  /** Preserved human player state from a previous scene (e.g. building interior). */
  humanSnap?: PlayerSnapshot;
  /** Preserved cat player state from a previous scene. */
  catSnap?: PlayerSnapshot;
  /** Existing map to reuse instead of generating a new one (e.g. returning from building). */
  existingMap?: GameMap;
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
}

export class DungeonScene extends GameplayScene {
  private gameMap: GameMap;
  readonly pm: PlayerManager;
  private mobs: Mob[];
  private mobGrid!: SpatialGrid<Mob>;

  // Systems
  private miniMap: MiniMapSystem;
  private safeRoom: SafeRoomSystem;
  private bossRoom: BossRoomSystem;
  private dynamite: DynamiteSystem;
  private spells: SpellSystem;
  private companion: CompanionSystem;
  private loot: LootSystem;
  private stairwell: StairwellSystem;
  private building: BuildingSystem | null = null;
  private juicerRoom: JuicerRoomSystem;
  private barriers: BarrierSystem;
  private gore = new GoreSystem();
  private playerTick = new PlayerTickSystem();
  private mongoSystem = new MongoSystem();
  private renderPipeline = new RenderPipeline();
  private mobLoop = new MobUpdateLoop();
  private bus = new EventBus();

  // UI
  protected pauseMenu: PauseMenu;
  private deathScreen: DeathScreen;
  private inventoryPanel: InventoryPanel;
  private gearPanel: GearPanel;
  private lootBoxOpener: LootBoxOpener;
  private achievementNotif = new AchievementNotification();

  // Achievement state
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;
  private _notifActive = false;
  private _notifQueue: Array<{
    def: AchievementDef;
    mgr: AchievementManager;
    player: 'Human' | 'Cat';
  }> = [];
  private _achievIconRect = { x: 0, y: 0, w: 80, h: 28 };
  private _lootBoxIconRect = { x: -9999, y: 0, w: 0, h: 0 };

  // Boss battle intro
  private bossIntro = new BossIntroSystem();

  // Arena (Ball of Swine) state
  private arenaPhase2Active = false;
  private arenaLiveTusklings: Tuskling[] = [];
  private arenaStairwellUnlocked = false;
  private arenaLocked = false;

  // Floor entry snapshots (used to respawn players at floor-start state on death)
  private floorEntryHumanSnap!: PlayerSnapshot;
  private floorEntryCatSnap!: PlayerSnapshot;
  private floorEntryHumanAchievements!: AchievementManager;
  private floorEntryCatAchievements!: AchievementManager;

  // Misc state
  private gameOver = false;
  protected readonly notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  private readonly LEVEL_TIME_LIMIT = 216_000; // 1 hour @ 60 fps
  private safeRoomEntered = false;
  private speechBubblePulse = 0;

  // Key handlers
  private readonly inputHandler = new DungeonInputHandler();

  // Mobile touch state (encapsulated)
  private readonly touch = new MobileTouchState();
  private krakarenKilled = false;

  // Mouse position in screen coords (updated by handleMouseMove)
  private _mouseX = -9999;
  private _mouseY = -9999;

  constructor(
    private readonly levelDef: LevelDef,
    input: InputManager,
    sceneManager: SceneManager,
    options?: DungeonSceneOptions,
  ) {
    super(input, sceneManager);

    this.gameMap =
      options?.existingMap ??
      new GameMap({
        mapSize: levelDef.mapSize,
        tileHeight: TILE_SIZE,
        numBossRooms: levelDef.bossRooms?.length ?? 1,
        numSafeRooms: 2,
        numStairwellsOverride: levelDef.numStairwells,
        mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
        hasArena: levelDef.hasArena ?? false,
        bossTypes: levelDef.bossRooms?.map((b) => b.type) ?? [],
      });
    this.levelTimerFrames = levelDef.isSafeLevel ? 0 : this.LEVEL_TIME_LIMIT;

    const spawn = options?.spawnAt ?? this.gameMap.startTile;
    const { x: sx, y: sy } = spawn;
    this.pm = new PlayerManager(sx, sy);

    // Restore player state if returning from a sub-scene (e.g. building interior)
    if (options?.humanSnap) restorePlayer(this.human, options.humanSnap);
    if (options?.catSnap) restorePlayer(this.cat, options.catSnap);
    // Re-apply spawn position (restorePlayer doesn't touch x/y)
    this.pm.setPositions(sx, sy);

    // Capture floor-entry state for death respawn. If the caller already
    // provides a floor-entry snap (i.e. we're respawning after death), reuse
    // it so repeated deaths always reset to the same floor-start state.
    this.floorEntryHumanSnap = options?.floorEntryHumanSnap ?? snapPlayer(this.human);
    this.floorEntryCatSnap = options?.floorEntryCatSnap ?? snapPlayer(this.cat);

    this.mobs = spawnForLevel(levelDef, this.gameMap);

    // Spawn a few Troglodytes near the Juicer's boss room (bossRooms[1])
    if (levelDef.bossRooms?.[1]?.type === 'juicer') {
      const juicerRoom = this.gameMap.bossRooms[1];
      if (juicerRoom) {
        const { x: jcx, y: jcy } = juicerRoom.centre;
        for (const [dx, dy] of [
          [-3, -2],
          [3, -2],
          [0, 3],
        ] as [number, number][]) {
          this.mobs.push(createMob('troglodyte', jcx + dx, jcy + dy, this.gameMap));
        }
      }
    }

    // Spawn Ball of Swine at arena centre (dungeon levels only)
    if (!levelDef.isOverworld && this.gameMap.arenaExteriors.length > 0) {
      const arena = this.gameMap.arenaExteriors[0];
      const bos = new BallOfSwine(arena.centre.x, arena.centre.y, TILE_SIZE);
      bos.setArena(arena.centre.x, arena.centre.y);
      bos.setMap(this.gameMap);
      this.mobs.push(bos);
    }

    // Spawn Sky Fowls wandering around the overworld town square
    if (levelDef.isOverworld) {
      const mapCx = Math.floor(levelDef.mapSize / 2);
      const mapCy = Math.floor(levelDef.mapSize / 2);
      // Positions scattered around the town square (22×22 road area centered on mapCx/mapCy)
      const fowlOffsets: [number, number][] = [
        [-8, -5],
        [6, -7],
        [-6, 4],
        [8, 3],
        [-2, 7],
        [7, -3],
        [-5, -8],
        [3, 6],
        [-8, 2],
        [5, -4],
        [0, -8],
        [-4, -4],
      ];
      for (const [dx, dy] of fowlOffsets) {
        this.mobs.push(createMob('sky_fowl', mapCx + dx, mapCy + dy, this.gameMap));
      }
    }

    this.cat.setMap(this.gameMap);

    this.mobGrid = new SpatialGrid<Mob>(TILE_SIZE * 4);
    for (const mob of this.mobs) this.mobGrid.insert(mob);

    // Systems
    this.miniMap = new MiniMapSystem(this.gameMap);
    this.safeRoom = new SafeRoomSystem(this.gameMap, sx, sy, this.levelDef.id);
    this.bossRoom = new BossRoomSystem(
      this.gameMap,
      this.miniMap,
      levelDef.bossRooms?.map((b) => b.type) ?? [],
    );
    this.juicerRoom = new JuicerRoomSystem(this.gameMap.bossRooms[1]?.bounds);
    this.barriers = new BarrierSystem(this.gameMap);
    this.dynamite = new DynamiteSystem(this.gameMap);
    this.spells = new SpellSystem();
    this.companion = new CompanionSystem(this.gameMap, sx, sy);
    this.loot = new LootSystem(this.gameMap);
    this.stairwell = new StairwellSystem(this.gameMap, levelDef, () => {
      if (!levelDef.nextLevelId) return;
      // Dismiss Mongo before floor transition
      this.mongoSystem.dismiss(this.mobs, this.mobGrid);
      this.sceneManager.replace(
        new DungeonScene(getLevelDef(levelDef.nextLevelId), this.input, this.sceneManager, {
          humanSnap: snapPlayer(this.human),
          catSnap: snapPlayer(this.cat),
          humanAchievements: this.humanAchievements,
          catAchievements: this.catAchievements,
          mongoUnlocked: this.mongoSystem.unlocked,
        }),
      );
    });

    if (levelDef.isOverworld) {
      this.building = new BuildingSystem(this.gameMap, (entry) => {
        // Spawn one tile south of the door so the player exits outside and
        // doesn't immediately re-trigger the "Enter building?" prompt.
        const returnTile = {
          x: entry.doorTile.x,
          y: entry.doorTile.y + 1,
        };
        const humanSnap = snapPlayer(this.human);
        const catSnap = snapPlayer(this.cat);
        this.sceneManager.replace(
          new BuildingInteriorScene(
            entry,
            humanSnap,
            catSnap,
            this.input,
            this.sceneManager,
            (hSnap, cSnap) => {
              this.sceneManager.replace(
                new DungeonScene(levelDef, this.input, this.sceneManager, {
                  spawnAt: returnTile,
                  humanSnap: hSnap,
                  catSnap: cSnap,
                  existingMap: this.gameMap,
                }),
              );
            },
          ),
        );
      });
    }

    // UI
    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
    this.inventoryPanel = new InventoryPanel();
    this.gearPanel = new GearPanel();
    this.lootBoxOpener = new LootBoxOpener();

    // Achievements — carry over from previous floor if provided
    this.humanAchievements = options?.humanAchievements ?? new AchievementManager();
    this.catAchievements = options?.catAchievements ?? new AchievementManager();

    // Snapshot achievement state at floor entry so death-restarts can rewind it,
    // allowing players to re-earn achievements they unlocked during the failed run.
    this.floorEntryHumanAchievements =
      options?.floorEntryHumanAchievements ?? this.humanAchievements.clone();
    this.floorEntryCatAchievements =
      options?.floorEntryCatAchievements ?? this.catAchievements.clone();

    // Mongo summon state — carry unlock across floors
    if (options?.mongoUnlocked) {
      this.mongoSystem.unlocked = true;
    }

    this.wireEventBus();
  }

  /** Subscribe systems to EventBus events, replacing imperative orchestration. */
  private wireEventBus(): void {
    const bus = this.bus;

    // ── spawnGore: decoupled so any system can trigger gore independently ──
    bus.on('spawnGore', (e) => {
      this.gore.spawnGore(e.x, e.y);
    });

    // ── mobKilled: corpse marker, achievements, loot, grub spawns ──
    bus.on('mobKilled', (e) => {
      const { mob, killer, topDamageDealer } = e;
      const cx = mob.x + TILE_SIZE * 0.5;
      const cy = mob.y + TILE_SIZE * 0.5;

      // Gore via spawnGore event (decoupled from kill logic)
      bus.emit('spawnGore', { x: cx, y: cy });

      // Corpse marker on minimap
      this.miniMap.addCorpseMarker(cx, cy);

      // Achievements — first_blood
      if (killer === this.human) this.humanAchievements.tryUnlock('first_blood');
      if (killer === this.cat) this.catAchievements.tryUnlock('first_blood');

      // Achievements — smush (Human melee punch kill)
      if (killer === this.human && mob.killType === 'melee' && this.human.nextType === 'punch') {
        this.humanAchievements.tryUnlock('smush');
      }

      // Achievements — magic_touch (Cat missile kill)
      if (killer === this.cat && mob.killType === 'missile') {
        this.catAchievements.tryUnlock('magic_touch');
      }

      // Loot drop
      if (mob.droppedLoot && topDamageDealer) {
        this.loot.addLoot(cx, cy, mob.droppedLoot, topDamageDealer, mob.isBoss);
        mob.droppedLoot = null;
      }

      // Boss-specific effects (regular bosses managed by BossRoomSystem)
      if (mob.isBoss) {
        bus.emit('bossDefeated', {
          bossType: (mob.constructor as { name?: string }).name ?? 'unknown',
          mob,
        });
      }

      // Ball of Swine is an arena boss (isBoss=false), handle separately
      if (mob instanceof BallOfSwine) {
        bus.emit('bossDefeated', { bossType: 'ball_of_swine', mob });
      }

      // Krakaren Clone — also not flagged as isBoss
      if (mob instanceof KrakarenClone) {
        bus.emit('bossDefeated', { bossType: 'krakaren_clone', mob });
      }

      // Level 2: enemy deaths spawn Brindle Grubs
      if (this.levelDef.id === 'level2' && !(mob instanceof BrindleGrub)) {
        const tx = Math.round(mob.x / TILE_SIZE);
        const ty = Math.round(mob.y / TILE_SIZE);
        const count = 1 + Math.floor(Math.random() * 5);
        for (let i = 0; i < count; i++) {
          let placed = false;
          for (let attempt = 0; attempt < 8 && !placed; attempt++) {
            const ox = Math.floor((Math.random() - 0.5) * 4);
            const oy = Math.floor((Math.random() - 0.5) * 4);
            const gtx = tx + ox;
            const gty = ty + oy;
            if (!this.gameMap.isWalkable(gtx, gty)) continue;
            const grub = new BrindleGrub(gtx, gty, TILE_SIZE);
            grub.setMap(this.gameMap);
            this.mobs.push(grub);
            this.mobGrid.insert(grub);
            placed = true;
          }
        }
      }
    });

    // ── bossDefeated: boss_slayer achievement, BoS tusklings, Krakaren → Mongo ──
    bus.on('bossDefeated', (e) => {
      // boss_slayer achievement for both players
      if (!this.humanAchievements.tryUnlock('boss_slayer')) {
        this.humanAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }
      if (!this.catAchievements.tryUnlock('boss_slayer')) {
        this.catAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }

      // Ball of Swine burst → spawn 8 dazed Tusklings
      if (e.bossType === 'ball_of_swine' && !this.arenaPhase2Active) {
        this.arenaPhase2Active = true;
        this.arenaLiveTusklings = [];
        const arena = this.gameMap.arenaExteriors[0];
        const acx = arena ? arena.centre.x : Math.floor(e.mob.x / TILE_SIZE);
        const acy = arena ? arena.centre.y : Math.floor(e.mob.y / TILE_SIZE);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const r = 3;
          const tx = acx + Math.round(Math.cos(angle) * r);
          const ty = acy + Math.round(Math.sin(angle) * r);
          const tusk = new Tuskling(tx, ty, TILE_SIZE);
          tusk.setMap(this.gameMap);
          tusk.dazeTimer = 600;
          this.mobs.push(tusk);
          this.mobGrid.insert(tusk);
          this.arenaLiveTusklings.push(tusk);
        }
      }

      // Krakaren Clone death → unlock Mongo
      if (e.bossType === 'krakaren_clone' && !this.krakarenKilled) {
        this.krakarenKilled = true;
        this.mongoSystem.unlocked = true;
      }
    });

    // ── safeRoomEntered: safe_haven achievement ──
    bus.on('safeRoomEntered', () => {
      this.humanAchievements.tryUnlock('safe_haven');
      this.catAchievements.tryUnlock('safe_haven');
    });
  }

  // Scene lifecycle

  onEnter(): void {
    this.inputHandler.bind({
      isSuppressed: () => this.pauseMenu.isOpen || this.safeRoom.isSleeping,
      isGameOver: () => this.gameOver,
      dismissDialog: () => {
        if (this.safeRoom.mordecaiDialogOpen) {
          this.safeRoom.mordecaiDialogOpen = false;
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
      togglePause: () => {
        this.pauseMenu.toggle();
        if (!this.pauseMenu.isOpen) this.input.clear();
      },
      clearInput: () => this.input.clear(),
      switchCharacter: () => this.triggerSwitchCharacter(),
      spaceAction: () => this.triggerSpaceAction(),
      usePotion: () => {
        if (this.human.isActive) this.human.usePotion();
        else this.cat.usePotion();
      },
      toggleInventory: () => this.inventoryPanel.toggle(),
      toggleGear: () => this.gearPanel.toggle(),
      companionFollow: () => this.triggerCompanionFollow(),
      toggleMiniMap: () => this.miniMap.toggle(),
      mongoSummon: () => this.triggerMongoSummon(),
      hotbarActivation: (idx) => this.triggerHotbarActivation(idx),
      dynamiteRelease: (idx) => {
        if (this.dynamite.chargingHotbarIdx === idx) {
          this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
          return true;
        }
        return false;
      },
    });
  }

  onExit(): void {
    this.inputHandler.unbind();
    this.bus.clear();
  }

  // Shared action helpers (keyboard + touch)

  private triggerSwitchCharacter(): void {
    this.safeRoom.mordecaiDialogOpen = false;
    this.pm.switchActive();
    this.cat.autoTarget = null;
    this.human.autoTarget = null;
    this.companion.isFollowOverride = false;
  }

  private triggerCompanionFollow(): void {
    this.companion.isFollowOverride = true;
    this.inactive().autoTarget = null;
  }

  private triggerMongoSummon(): void {
    if (!this.cat.isActive || !this.mongoSystem.canSummon) return;
    const mongo = this.mongoSystem.summon(this.cat, this.gameMap, this.levelDef.id);
    if (mongo) {
      this.mobs.push(mongo);
      this.mobGrid.insert(mongo);
    }
  }

  private triggerSpaceAction(tapScreenX?: number, tapScreenY?: number): void {
    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.mordecaiDialogOpen = false;
      return;
    }
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) {
      if (this.safeRoom.isNearBed(active)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(active)) {
        this.safeRoom.mordecaiDialogOpen = true;
      }
      return;
    }
    if (this.juicerRoom.tryPickupNear(active) || this.barriers.tryPickupNear(active)) {
      return;
    }
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
    if (this.human.isActive) {
      this.companion.snapFacingToNearestMob(this.human, TILE_SIZE * 3, this.mobGrid);
      this.human.triggerAttack();
    } else {
      this.companion.snapFacingToNearestMob(this.cat, TILE_SIZE * 5, this.mobGrid);
      this.cat.triggerAttack();
    }
  }

  private triggerHotbarActivation(hotbarIdx: number): void {
    const active = this.active();
    const slot = active.inventory.hotbar[hotbarIdx];
    if (slot?.id === 'health_potion') {
      active.usePotion();
    } else if (slot?.abilityId === 'protective_shell') {
      this.spells.triggerProtectiveShell(this.human, this.mobGrid);
    } else if (slot?.id === 'scroll_of_confusing_fog') {
      this.spells.castConfusingFog(active);
    } else if (slot?.id === 'goblin_dynamite' && this.human.isActive) {
      if (this.dynamite.isCharging) {
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
      } else {
        this.dynamite.beginCharge(hotbarIdx);
      }
    } else if (
      (slot?.id === 'gym_dumbbell' ||
        slot?.id === 'gym_bench_press' ||
        slot?.id === 'gym_treadmill') &&
      !this.barriers.isConstructing
    ) {
      this.barriers.beginConstruct(this.active(), hotbarIdx, slot.id);
    }
  }

  handleClick(mx: number, my: number): void {
    if (this.lootBoxOpener.isOpen) {
      this.lootBoxOpener.skip();
      return;
    }

    if (this._notifActive) {
      if (this.achievementNotif.handleClick(mx, my)) {
        const shown = this._notifQueue.shift();
        if (shown) {
          const idx = shown.mgr.pendingNotifications.indexOf(shown.def);
          if (idx >= 0) shown.mgr.pendingNotifications.splice(idx, 1);
        }
        if (this._notifQueue.length > 0) {
          this.achievementNotif.reset();
        } else {
          this._notifActive = false;
        }
      }
      return;
    }

    // Desktop summon button click
    if (
      !IS_MOBILE &&
      !this.gameOver &&
      !this.pauseMenu.isOpen &&
      this.mongoSystem.canShow &&
      this.cat.isActive
    ) {
      const sb = this.touch.summonBtnRect;
      if (mx >= sb.x && mx <= sb.x + sb.w && my >= sb.y && my <= sb.y + sb.h) {
        this.triggerMongoSummon();
        return;
      }
    }

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const ai = this._achievIconRect;
      if (mx >= ai.x && mx <= ai.x + ai.w && my >= ai.y && my <= ai.y + ai.h) {
        const totalUnread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
        if (totalUnread > 0) {
          this._notifQueue = [
            ...this.humanAchievements.pendingNotifications.map((def) => ({
              def,
              mgr: this.humanAchievements,
              player: 'Human' as const,
            })),
            ...this.catAchievements.pendingNotifications.map((def) => ({
              def,
              mgr: this.catAchievements,
              player: 'Cat' as const,
            })),
          ];
          if (this._notifQueue.length > 0) {
            this._notifActive = true;
            this.achievementNotif.reset();
          }
        }
        return;
      }
    }

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const lb = this._lootBoxIconRect;
      if (mx >= lb.x && mx <= lb.x + lb.w && my >= lb.y && my <= lb.y + lb.h) {
        const unread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
        if (unread === 0) {
          if (this.humanAchievements.pendingBoxes.length > 0) {
            this.openBoxQueue('human');
          } else if (this.catAchievements.pendingBoxes.length > 0) {
            this.openBoxQueue('cat');
          }
        }
        return;
      }
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.mordecaiDialogOpen = false;
      return;
    }

    if (this.stairwell.menuOpen) {
      this.stairwell.handleClick(mx, my, this.sceneManager.canvas);
      return;
    }

    if (this.building?.menuOpen) {
      this.building.handleClick(mx, my, this.sceneManager.canvas);
      return;
    }

    if (this.gameOver) {
      if (this.deathScreen.handleClick(mx, my, this.sceneManager.canvas)) {
        this.sceneManager.replace(
          new DungeonScene(this.levelDef, this.input, this.sceneManager, {
            humanSnap: this.floorEntryHumanSnap,
            catSnap: this.floorEntryCatSnap,
            floorEntryHumanSnap: this.floorEntryHumanSnap,
            floorEntryCatSnap: this.floorEntryCatSnap,
            humanAchievements: this.floorEntryHumanAchievements.clone(),
            catAchievements: this.floorEntryCatAchievements.clone(),
            floorEntryHumanAchievements: this.floorEntryHumanAchievements,
            floorEntryCatAchievements: this.floorEntryCatAchievements,
            mongoUnlocked: this.mongoSystem.unlocked,
          }),
        );
      }
      return;
    }

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }

    const canvas = this.sceneManager.canvas;
    const active = this.active();

    const gearResult = this.gearPanel.handleClick(mx, my, canvas, active.inventory);
    if (gearResult) {
      if (gearResult.unequippedItem) active.removeItemBonus(gearResult.unequippedItem);
      return;
    }

    if (this.gearPanel.isOpen && this.inventoryPanel.isOpen) {
      const slotIdx = this.inventoryPanel.getClickedInventorySlot(mx, my, canvas, active.inventory);
      if (slotIdx !== null) {
        const item = active.inventory.slots[slotIdx];
        if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
          const prev = active.inventory.equip(slotIdx);
          if (prev) active.removeItemBonus(prev);
          active.applyItemBonus(item);
          return;
        }
      }
    }

    if (this.inventoryPanel.handleClick(mx, my, canvas, active.inventory)) {
      this.resolvePendingInventoryAction(active);
      return;
    }

    const { x: camX, y: camY } = this.camera();
    if (this.loot.tryCollectLootAt(mx, my, camX, camY, active)) return;

    const pb = this.pauseButtonRect();
    if (mx >= pb.x && mx <= pb.x + pb.w && my >= pb.y && my <= pb.y + pb.h) {
      this.pauseMenu.toggle();
    }
  }

  private clearInvLongPress(): void {
    if (this.touch.longPressTimer !== null) {
      clearTimeout(this.touch.longPressTimer);
      this.touch.longPressTimer = null;
    }
    this.touch.longPressPos = null;
  }

  handleMouseDown(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.handleMouseDown(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this.inventoryPanel.handleMouseMove(mx, my);
    this.gearPanel.handleMouseMove(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleMouseUp(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.handleMouseUp(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleContextMenu(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.openContextMenu(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  // Main update / render

  update(): void {
    if (this.lootBoxOpener.isOpen) this.lootBoxOpener.tick();
    if (this._notifActive) this.achievementNotif.tick();

    if (this.bossIntro.isActive) {
      this.bossIntro.tick();
      return;
    }

    if (
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.stairwell.menuOpen ||
      this.building?.menuOpen
    )
      return;

    if (this.safeRoom.isSleeping) {
      const deduct = this.safeRoom.updateSleep(this.human, this.cat);
      this.levelTimerFrames = Math.max(0, this.levelTimerFrames - deduct);
      return;
    }

    this.updateGameplay();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const canvas = this.sceneManager.canvas;
    const { x: camX, y: camY } = this.camera();

    const rc: RenderContext = {
      canvas,
      camX,
      camY,
      gameMap: this.gameMap,
      pm: this.pm,
      active: this.active(),
      inactive: this.inactive(),
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      gameOver: this.gameOver,
      pauseMenuOpen: this.pauseMenu.isOpen,
      gore: this.gore,
      safeRoom: this.safeRoom,
      bossRoom: this.bossRoom,
      juicerRoom: this.juicerRoom,
      stairwell: this.stairwell,
      building: this.building,
      barriers: this.barriers,
      spells: this.spells,
      dynamite: this.dynamite,
      loot: this.loot,
      miniMap: this.miniMap,
      mongoSystem: this.mongoSystem,
      speechBubblePulse: this.speechBubblePulse,
    };

    // Layer 1: World (map, gore puddles, room objects, door hints)
    this.renderPipeline.renderWorld(ctx, rc);

    // Layer 2: Entities (Y-sorted mobs, players, decorations)
    this.renderPipeline.renderEntities(ctx, rc);

    // Layer 3: Effects (particles, barriers, spells, dynamite, speech bubbles)
    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) => this.renderLevelUpFlash(c, cx, cy));

    // Layer 4: Screen-space UI
    this.renderHealthVignette(ctx, canvas);
    this.renderHUD(ctx, canvas);

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.miniMap.render(
        ctx,
        canvas,
        this.active(),
        this.inactive(),
        this.mobs,
        this.safeRoom.mordecaiPositions,
      );
      const mmSz = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
      this.touch.miniMapRect = {
        x: canvas.width - mmSz - 8,
        y: 8,
        w: mmSz,
        h: mmSz,
      };
    } else {
      this.touch.miniMapRect = { x: -9999, y: 0, w: 0, h: 0 };
    }

    if (!this.levelDef.isSafeLevel && !this.gameOver) {
      this.renderLevelTimer(ctx, canvas);
    }

    this.bossRoom.renderUI(ctx, canvas, camX, camY, this.mobs, this.human, this.cat);
    this.renderArenaUI(ctx, canvas);

    this.loot.render(ctx, camX, camY, this.active());

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const active = this.active();
      const name = this.human.isActive ? 'Human' : 'Cat';
      this.inventoryPanel.abilityCooldowns.set('protective_shell', {
        current: this.spells.shellCooldown,
        max: this.spells.shellCooldownMax,
      });
      this.inventoryPanel.render(ctx, canvas, active.inventory, name, active.coins);
      this.gearPanel.render(ctx, canvas, active.inventory, name);
      this.dynamite.renderChargeBar(ctx, canvas.width, canvas.height);
      this.barriers.renderConstructUI(ctx, canvas);
      // Mongo summon button (desktop: left side above hotbar, mobile: in renderMobileButtons)
      if (!IS_MOBILE && this.mongoSystem.canShow && this.cat.isActive) {
        this.touch.summonBtnRect = this.mongoSystem.renderSummonButton(
          ctx,
          10,
          canvas.height - 52 - 12 - 52 - 8,
          80,
          48,
          this.cat.isActive,
        );
      }
      if (IS_MOBILE) this.renderMobileButtons(ctx, canvas);
    }

    if (this.gameOver) {
      this.deathScreen.render(ctx, canvas);
    }

    if (this.pauseMenu.isOpen) {
      const inSafe = this.human.isProtected || this.cat.isProtected;
      const onOpenHuman =
        inSafe && this.humanAchievements.pendingBoxes.length > 0
          ? () => this.openBoxQueue('human')
          : undefined;
      const onOpenCat =
        inSafe && this.catAchievements.pendingBoxes.length > 0
          ? () => this.openBoxQueue('cat')
          : undefined;
      this.pauseMenu.render(
        ctx,
        canvas,
        this.human,
        this.cat,
        this.humanAchievements,
        this.catAchievements,
        inSafe,
        onOpenHuman,
        onOpenCat,
      );
    }

    if (this.lootBoxOpener.isOpen) {
      this.lootBoxOpener.render(ctx, canvas);
    }

    this.drawPauseButton(ctx, canvas);
    this.drawAchievementIcon(ctx);
    this.drawLootBoxIcon(ctx, canvas);

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.safeRoom.renderUI(ctx, canvas, camX, camY, this.active());
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.renderMordecaiDialog(ctx, canvas);
    }

    if (this.stairwell.menuOpen) {
      this.stairwell.renderMenu(ctx, canvas);
    }

    if (this.building?.menuOpen) {
      this.building.renderMenu(ctx, canvas);
    }

    if (this.safeRoom.isSleeping) {
      this.safeRoom.renderSleepOverlay(ctx, canvas);
    }

    if (this._notifActive && this._notifQueue.length > 0) {
      this.achievementNotif.render(
        ctx,
        canvas,
        this._notifQueue[0].def,
        this._notifQueue[0].player,
      );
    }

    if (this.bossIntro.isActive) {
      this.bossIntro.render(ctx, canvas);
    }

    if (!IS_MOBILE) {
      this.renderEntityTooltip(ctx, canvas, camX, camY);
    }
  }

  private renderEntityTooltip(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
  ): void {
    if (this.gameOver || this.pauseMenu.isOpen || this.lootBoxOpener.isOpen) return;

    const mx = this._mouseX;
    const my = this._mouseY;

    // Convert screen coords to world coords
    const wx = mx + camX;
    const wy = my + camY;

    // Find the first live mob under the cursor
    let hovered: Mob | null = null;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      if (wx >= mob.x && wx <= mob.x + TILE_SIZE && wy >= mob.y && wy <= mob.y + TILE_SIZE) {
        hovered = mob;
        break;
      }
    }

    if (!hovered) return;

    const name = hovered.displayName;
    const desc = hovered.description;

    // Layout
    const PAD = 8;
    const LINE_GAP = 4;
    ctx.font = 'bold 13px sans-serif';
    const nameW = ctx.measureText(name).width;
    ctx.font = '11px sans-serif';
    const descW = ctx.measureText(desc).width;
    const boxW = Math.max(nameW, descW) + PAD * 2;
    const boxH = 13 + LINE_GAP + 11 + PAD * 2;

    // Position tooltip above cursor, keep on screen
    let tx = mx + 12;
    let ty = my - boxH - 8;
    if (tx + boxW > canvas.width - 4) tx = canvas.width - boxW - 4;
    if (ty < 4) ty = my + 20;

    // Background
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#1a1a2e';
    ctx.strokeStyle = hovered.isHostile ? '#ef4444' : '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(tx, ty, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Name
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = hovered.isHostile ? '#fca5a5' : '#86efac';
    ctx.fillText(name, tx + PAD, ty + PAD + 12);

    // Description
    if (desc) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#d1d5db';
      ctx.fillText(desc, tx + PAD, ty + PAD + 12 + LINE_GAP + 11);
    }

    ctx.restore();
  }

  // Core gameplay update

  private updateGameplay(): void {
    const player = this.active();

    // Phase 1 & 2: Movement input → collision-checked position update
    const move = readMovement(
      this.input,
      this.touch.moveTarget,
      this.touch.tapStart,
      player,
      this.camera(),
    );
    applyMovement(player, move, this.gameMap);

    // Safe room flags
    this.pm.updateProtection(this.safeRoom);

    if (!this.safeRoomEntered && this.pm.isAnySafe(this.safeRoom)) {
      this.safeRoomEntered = true;
      this.bus.emit('safeRoomEntered', {});
    }

    this.safeRoom.evictMobs(this.mobs, this.mobGrid);
    this.safeRoom.updateWander();
    this.bossRoom.update(this.mobs, this.mobGrid, this.human, this.cat);

    // Arena door lock: lock when either player enters with BoS alive, unlock on BoS death
    if (this.gameMap.arenaExteriors.length > 0) {
      const arena = this.gameMap.arenaExteriors[0];
      const bos = this.mobs.find((m) => m instanceof BallOfSwine) as BallOfSwine | undefined;
      if (bos) {
        const cx = arena.centre.x * TILE_SIZE;
        const cy = arena.centre.y * TILE_SIZE;
        const innerRadius = (arena.radius - 2) * TILE_SIZE;
        const humanInside = Math.hypot(this.human.x - cx, this.human.y - cy) < innerRadius;
        const catInside = Math.hypot(this.cat.x - cx, this.cat.y - cy) < innerRadius;
        if (!this.arenaLocked && bos.isAlive && (humanInside || catInside)) {
          this.arenaLocked = true;
          this.gameMap.lockArenaDoor();
          this.bossRoom.newlyLockedBossType = 'ball_of_swine';
        }
        if (this.arenaLocked && !bos.isAlive && !this.arenaPhase2Active) {
          this.arenaLocked = false;
          this.gameMap.unlockArenaDoor();
        }
      }
    }

    // Trigger boss battle intro on first room entry
    if (this.bossRoom.newlyLockedBossType !== null) {
      const bt = this.bossRoom.newlyLockedBossType;
      this.bossRoom.newlyLockedBossType = null;
      const meta = BOSS_META[bt] ?? {
        displayName: 'THE BOSS',
        color: '#ef4444',
      };
      this.bossIntro.trigger(bt, meta.displayName, meta.color);
    }

    // Reset slow state before BarrierSystem re-applies it
    for (const mob of this.mobs) mob.isSlowed = false;
    this.barriers.update(this.mobs, this.mobGrid, this.gameMap);

    // Juicer room gym pickups + Juicer AI coordination
    const juicer = (this.mobs.find((m) => m instanceof Juicer) as Juicer | undefined) ?? null;
    this.juicerRoom.update(this.human, this.cat, juicer, this.mobs);

    this.companion.update(this.human, this.cat, this.mobs, this.mobGrid, player.isMoving);

    this.human.updateAttack();
    this.cat.updateMissiles();

    // Spell system (resets confusion, ticks fogs/shell)
    this.spells.update(this.mobs, this.mobGrid);

    // Mob AI tick (activation radius, pathfinding, boss clamping)
    this.mobLoop.update({
      human: this.human,
      cat: this.cat,
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      bossRoom: this.bossRoom,
      extraTargets: this.mongoSystem.mongo ? [this.mongoSystem.mongo] : undefined,
    });

    const combatCtx: CombatContext = {
      human: this.human,
      cat: this.cat,
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      gameMap: this.gameMap,
      safeRoom: this.safeRoom,
      bus: this.bus,
    };
    resolvePlayerAttacks(combatCtx);

    // Intercept Mongo lethal damage before resolveKills consumes justDied
    this.mongoSystem.checkHealth();

    // resolveKills emits mobKilled → listeners handle gore, loot, achievements,
    // grub spawns, BoS tuskling burst, Krakaren → Mongo unlock
    resolveKills(combatCtx);

    // Arena phase 2: unlock stairwell when all spawned Tusklings are dead
    if (
      this.arenaPhase2Active &&
      !this.arenaStairwellUnlocked &&
      this.arenaLiveTusklings.length > 0 &&
      this.arenaLiveTusklings.every((t) => !t.isAlive)
    ) {
      this.arenaStairwellUnlocked = true;
      this.gameMap.unlockArenaStairwell();
      if (this.arenaLocked) {
        this.arenaLocked = false;
        this.gameMap.unlockArenaDoor();
      }
    }

    // Update Mongo system (cooldown, recall, despawn)
    this.mongoSystem.update(this.mobs, this.mobGrid);

    this.pm.tickTimers();

    this.playerTick.update(this.human, this.cat);

    this.loot.update(this.active(), this.inactive());

    this.speechBubblePulse++;

    this.gore.update();
    this.dynamite.update(this.human, this.cat, this.mobs, this.mobGrid);

    if (!this.levelDef.isSafeLevel && this.levelTimerFrames > 0) {
      this.levelTimerFrames--;
    }

    // Phase 8: Mini-map fog reveal
    revealMinimap(player, this.miniMap);

    this.stairwell.detect(this.active());
    this.building?.detect(this.active());

    // Phase 9: Death check
    if (
      !this.gameOver &&
      checkDeath(this.human, this.cat, !!this.levelDef.isSafeLevel, this.levelTimerFrames)
    ) {
      this.gameOver = true;
      this.barriers.cancelConstruct();
      this.deathScreen.activate();
    }
  }

  // Arena UI

  private renderArenaUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const bos = this.mobs.find((m) => m instanceof BallOfSwine) as BallOfSwine | undefined;

    if (bos && bos.isAlive) {
      // Only show health bar when active player is near the arena
      const arena = this.gameMap.arenaExteriors[0];
      if (arena) {
        const player = this.active();
        const distToArena = Math.hypot(
          player.x - arena.centre.x * TILE_SIZE,
          player.y - arena.centre.y * TILE_SIZE,
        );
        if (distToArena > (arena.radius + 5) * TILE_SIZE) {
          return;
        }
      }
      const meta = { displayName: 'BALL OF SWINE', color: '#f87171' };
      const barW = Math.min(360, canvas.width * 0.5);
      const barH = 18;
      const barX = Math.floor((canvas.width - barW) / 2);
      const barY = 48;
      const hpFrac = Math.max(0, bos.hp / bos.maxHp);

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(barX - 6, barY - 22, barW + 12, barH + 30);
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - 6, barY - 22, barW + 12, barH + 30);

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = bos.isStopped ? '#fde68a' : meta.color;
      ctx.textAlign = 'center';
      ctx.fillText(
        bos.isStopped ? `★ ${meta.displayName} [STUNNED] ★` : meta.displayName,
        canvas.width / 2,
        barY - 6,
      );
      ctx.textAlign = 'left';

      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = bos.isStopped ? '#fde68a' : meta.color;
      ctx.fillRect(barX, barY, barW * hpFrac, barH);

      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      ctx.font = '9px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.fillText(`${bos.hp} / ${bos.maxHp}`, canvas.width / 2, barY + barH - 4);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // Phase 2: show how many Tusklings remain
    if (this.arenaPhase2Active && !this.arenaStairwellUnlocked) {
      const alive = this.arenaLiveTusklings.filter((t) => t.isAlive).length;
      ctx.save();
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = alive > 0 ? '#f87171' : '#4ade80';
      ctx.fillText(
        alive > 0 ? `Tusklings remaining: ${alive}` : 'All Tusklings defeated! Stairwell unlocked.',
        canvas.width / 2,
        78,
      );
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  // Inventory actions

  private resolvePendingInventoryAction(active: HumanPlayer | CatPlayer): void {
    if (this.inventoryPanel.pendingEquipSlot !== null) {
      const slotIdx = this.inventoryPanel.pendingEquipSlot;
      this.inventoryPanel.pendingEquipSlot = null;
      const item = active.inventory.slots[slotIdx];
      if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
        const prev = active.inventory.equip(slotIdx);
        if (prev) active.removeItemBonus(prev);
        active.applyItemBonus(item);
      }
    }

    if (this.inventoryPanel.pendingUnequipSlot !== null) {
      const slotIdx = this.inventoryPanel.pendingUnequipSlot;
      this.inventoryPanel.pendingUnequipSlot = null;
      const item = active.inventory.slots[slotIdx];
      if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
        active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
        active.removeItemBonus(item);
      }
    }

    if (this.inventoryPanel.pendingDropItem !== null) {
      const { id, quantity } = this.inventoryPanel.pendingDropItem;
      this.inventoryPanel.pendingDropItem = null;
      if (active.inventory.hasEquipped(id)) {
        const item =
          active.inventory.slots.find((s) => s?.id === id) ??
          active.inventory.hotbar.find((s) => s?.id === id) ??
          null;
        if (item?.equipSlot && item?.equipSubSlot) {
          active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
          active.removeItemBonus(item);
        }
      }
      active.inventory.removeItems(id, quantity);
      this.loot.addPlayerDrop(active.x, active.y, id, quantity, active);
    }
  }

  // Loot box queue

  private openBoxQueue(player: 'human' | 'cat'): void {
    const mgr = player === 'human' ? this.humanAchievements : this.catAchievements;
    const target = player === 'human' ? this.human : this.cat;
    const boxes = [...mgr.pendingBoxes];
    if (boxes.length === 0) return;
    this.pauseMenu.close();
    const playerName = player === 'human' ? 'Human' : 'Cat';
    this.lootBoxOpener.startQueue(
      boxes,
      playerName,
      (box, contents) => {
        mgr.openBox(box.id);
        contents.potions && target.inventory.addItem('health_potion', contents.potions);
        target.coins += contents.coins;
        if (contents.bonus) {
          this.human.inventory.addItem(
            contents.bonus.id as import('../core/Inventory').ItemId,
            contents.bonus.quantity,
          );
        }
      },
      () => {},
    );
  }

  // Camera

  private camera(): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const camX = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const camY = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x: Math.max(0, Math.min(mapPx - canvas.width, camX)),
      y: Math.max(0, Math.min(mapPx - canvas.height, camY)),
    };
  }

  // Rendering helpers

  private renderLevelUpFlash(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.pm.players()) {
      if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
      const alpha = p.levelUpFlash / 120;
      const rise = (1 - alpha) * 28;
      const sx = p.x - camX + TILE_SIZE / 2;
      const sy = p.y - camY - 12 - rise;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.fillText(`LEVEL UP! +${p.levelUpStat}`, sx, sy);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  private renderLevelTimer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const totalSec = Math.max(0, Math.ceil(this.levelTimerFrames / 60));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const display = `${min}:${sec.toString().padStart(2, '0')}`;

    const urgent = totalSec <= 60;
    const warning = totalSec <= 300;

    const mmSize = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    const w = 80;
    const h = 28;
    const x = canvas.width - w - 88;
    const y = 8 + mmSize + 20;

    const urgentAlpha = urgent ? 0.85 + Math.sin(Date.now() / 160) * 0.12 : 0.75;
    ctx.fillStyle = urgent
      ? `rgba(100,0,0,${urgentAlpha})`
      : warning
        ? 'rgba(80,40,0,0.85)'
        : 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = urgent ? '#ef4444' : warning ? '#f59e0b' : '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('TIME REMAINING', x + w / 2, y + 12);

    ctx.fillStyle = urgent ? '#f87171' : warning ? '#fbbf24' : '#e2e8f0';
    ctx.font = 'bold 17px monospace';
    ctx.fillText(display, x + w / 2, y + 29);
    ctx.textAlign = 'left';
  }

  private pauseButtonRect(): { x: number; y: number; w: number; h: number } {
    const mmSize = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    return {
      x: this.sceneManager.canvas.width - 88,
      y: 8 + mmSize + 20,
      w: 80,
      h: 28,
    };
  }

  private drawPauseButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    const pb = this.pauseButtonRect();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(IS_MOBILE ? 'Pause' : 'Pause (Esc)', pb.x + pb.w / 2, pb.y + pb.h / 2 + 4);
    ctx.textAlign = 'left';
    void canvas;
  }

  private achievementIconRect(): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const mmSize = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    return {
      x: this.sceneManager.canvas.width - 88,
      y: 8 + mmSize + 20 + 28 + 6,
      w: 80,
      h: 26,
    };
  }

  private drawAchievementIcon(ctx: CanvasRenderingContext2D): void {
    if (this.gameOver || this.pauseMenu.isOpen || this.lootBoxOpener.isOpen || this._notifActive) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const unread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
    if (unread === 0) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const inSafeRoom = this.human.isProtected || this.cat.isProtected;
    const canvas = this.sceneManager.canvas;

    if (inSafeRoom) {
      // Big flashing banner on the left (same spot as loot box icon)
      const w = 96;
      const h = 88;
      const x = 12;
      const y = canvas.height / 2 - h / 2;
      this._achievIconRect = { x, y, w, h };

      const t = Date.now();
      const pulse = 0.5 + 0.5 * Math.sin(t / 220);
      const bounce = Math.sin(t / 400) * 3;

      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18 + 14 * pulse;

      ctx.fillStyle = 'rgba(10, 20, 0, 0.92)';
      ctx.fillRect(x, y + bounce, w, h);

      ctx.strokeStyle = `rgba(134, 239, 172, ${0.55 + 0.45 * pulse})`;
      ctx.lineWidth = 2 + pulse;
      ctx.strokeRect(x, y + bounce, w, h);
      ctx.shadowBlur = 0;

      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd700';
      ctx.fillText('🏆', x + w / 2, y + bounce + 34);

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = `rgba(134, 239, 172, ${0.75 + 0.25 * pulse})`;
      ctx.fillText('ACHIEVEMENT!', x + w / 2, y + bounce + 54);

      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(unread === 1 ? '1 new' : `${unread} new`, x + w / 2, y + bounce + 68);

      ctx.textAlign = 'left';
      ctx.restore();
    } else {
      // Small button in top-right corner
      const r = this.achievementIconRect();
      this._achievIconRect = r;

      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
      ctx.fillStyle = 'rgba(26,42,10,0.9)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = `rgba(134,239,172,${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#86efac';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`🏆 NEW (${unread})`, r.x + r.w / 2, r.y + r.h / 2 + 4);
      ctx.textAlign = 'left';
    }
  }

  private drawLootBoxIcon(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const inSafe = this.human.isProtected || this.cat.isProtected;
    const totalBoxes =
      this.humanAchievements.pendingBoxes.length + this.catAchievements.pendingBoxes.length;

    const totalUnread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;

    if (
      !inSafe ||
      totalBoxes === 0 ||
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.lootBoxOpener.isOpen ||
      this._notifActive ||
      totalUnread > 0
    ) {
      this._lootBoxIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const w = 96;
    const h = 88;
    const x = 12;
    const y = canvas.height / 2 - h / 2;
    this._lootBoxIconRect = { x, y, w, h };

    const t = Date.now();
    const pulse = 0.5 + 0.5 * Math.sin(t / 220);
    const bounce = Math.sin(t / 400) * 3;

    ctx.save();
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18 + 14 * pulse;

    ctx.fillStyle = 'rgba(20, 14, 0, 0.92)';
    ctx.fillRect(x, y + bounce, w, h);

    ctx.strokeStyle = `rgba(255, 215, 0, ${0.55 + 0.45 * pulse})`;
    ctx.lineWidth = 2 + pulse;
    ctx.strokeRect(x, y + bounce, w, h);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('📦', x + w / 2, y + bounce + 36);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = `rgba(255, 215, 0, ${0.75 + 0.25 * pulse})`;
    ctx.fillText('OPEN LOOT!', x + w / 2, y + bounce + 54);

    ctx.font = '9px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(totalBoxes === 1 ? '1 box' : `${totalBoxes} boxes`, x + w / 2, y + bounce + 68);

    ctx.textAlign = 'left';
    ctx.restore();
  }

  // Health vignette

  private renderHealthVignette(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.gameOver) return;
    const player = this.active();
    const ratio = player.hp / player.maxHp;
    if (ratio >= 0.25) return;

    const cw = canvas.width;
    const ch = canvas.height;

    let alpha: number;
    if (ratio < 0.1) {
      // Blinking: fast pulse between 0.3 and 0.75
      alpha = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(Date.now() / 120));
    } else {
      // Hazy: steady, scales from 0.1 at 25% to 0.35 at 10%
      alpha = 0.1 + 0.25 * (1 - (ratio - 0.1) / 0.15);
    }

    const grad = ctx.createRadialGradient(
      cw / 2,
      ch / 2,
      Math.min(cw, ch) * 0.25,
      cw / 2,
      ch / 2,
      Math.max(cw, ch) * 0.85,
    );
    grad.addColorStop(0, 'rgba(220,0,0,0)');
    grad.addColorStop(1, `rgba(220,0,0,${alpha.toFixed(3)})`);

    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  // Mobile button rendering

  private renderMobileButtons(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // Position Switch/Follow buttons above the hotbar
    const SLOT_H = 52;
    const BOTTOM_MARGIN = 12;
    const BTN_W = 80;
    const BTN_H = 52;
    const MARGIN = 10;
    const btnY = canvas.height - SLOT_H - BOTTOM_MARGIN - BTN_H - 8;

    this.touch.switchBtnRect = { x: MARGIN, y: btnY, w: BTN_W, h: BTN_H };
    this.touch.followBtnRect = {
      x: canvas.width - MARGIN - BTN_W,
      y: btnY,
      w: BTN_W,
      h: BTN_H,
    };

    // Gear / Bag buttons stacked on the right side below the minimap column
    const mmSize = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    const rightX = canvas.width - 88;
    const pauseY = 8 + mmSize + 20;
    const achieveY = pauseY + 28 + 6;
    const gearY = achieveY + 26 + 6;
    this.touch.gearBtnRect = { x: rightX, y: gearY, w: 80, h: 28 };
    this.touch.bagBtnRect = { x: rightX, y: gearY + 34, w: 80, h: 28 };

    const drawBtn = (
      r: { x: number; y: number; w: number; h: number },
      icon: string,
      label: string,
      active: boolean,
    ) => {
      ctx.fillStyle = active ? 'rgba(250,204,21,0.25)' : 'rgba(0,0,0,0.65)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = active ? '#facc15' : '#475569';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(icon, r.x + r.w / 2, r.y + r.h / 2 + 2);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h - 6);
      ctx.textAlign = 'left';
    };

    const drawSmallBtn = (
      r: { x: number; y: number; w: number; h: number },
      label: string,
      active: boolean,
    ) => {
      ctx.fillStyle = active ? 'rgba(59,130,246,0.35)' : 'rgba(0,0,0,0.65)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = active ? '#3b82f6' : '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 4);
      ctx.textAlign = 'left';
    };

    const humanActive = this.human.isActive;
    drawBtn(
      this.touch.switchBtnRect,
      humanActive ? '🐱' : '🧍',
      humanActive ? 'Cat' : 'Human',
      false,
    );
    drawBtn(this.touch.followBtnRect, '↩', 'Follow', this.companion.isFollowOverride);
    drawSmallBtn(this.touch.gearBtnRect, 'Gear', this.gearPanel.isOpen);
    drawSmallBtn(this.touch.bagBtnRect, 'Bag', this.inventoryPanel.isOpen);

    // Mongo summon button — above the switch button when cat is active
    if (this.mongoSystem.canShow && this.cat.isActive) {
      const summonY = btnY - BTN_H - 6;
      this.touch.summonBtnRect = this.mongoSystem.renderSummonButton(
        ctx,
        MARGIN,
        summonY,
        BTN_W,
        BTN_H,
        this.cat.isActive,
      );
    } else {
      this.touch.summonBtnRect = { x: -9999, y: 0, w: 0, h: 0 };
    }
  }

  // Touch handlers (mobile)

  handleTouchStart(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // HUD collapse/expand toggle (mobile only)
      if (IS_MOBILE) {
        const ht = this._hudToggleRect;
        if (x >= ht.x && x <= ht.x + ht.w && y >= ht.y && y <= ht.y + ht.h) {
          this._hudCollapsed = !this._hudCollapsed;
          continue;
        }
      }

      // Minimap tap to expand/collapse (mobile only)
      if (IS_MOBILE && !this.gameOver && !this.pauseMenu.isOpen) {
        const mm = this.touch.miniMapRect;
        if (x >= mm.x && x <= mm.x + mm.w && y >= mm.y && y <= mm.y + mm.h) {
          this.miniMap.toggle();
          continue;
        }
      }

      // Gear / Bag buttons (mobile only)
      if (IS_MOBILE && !this.gameOver && !this.pauseMenu.isOpen) {
        const gb = this.touch.gearBtnRect;
        if (x >= gb.x && x <= gb.x + gb.w && y >= gb.y && y <= gb.y + gb.h) {
          this.gearPanel.toggle();
          continue;
        }
        const bb = this.touch.bagBtnRect;
        if (x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h) {
          this.inventoryPanel.toggle();
          continue;
        }
      }

      // Mobile Mongo summon button
      if (IS_MOBILE && this.mongoSystem.canShow && this.cat.isActive) {
        const mb = this.touch.summonBtnRect;
        if (x >= mb.x && x <= mb.x + mb.w && y >= mb.y && y <= mb.y + mb.h) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerMongoSummon();
          continue;
        }
      }

      // Mobile action buttons (always checked first)
      if (IS_MOBILE) {
        const sb = this.touch.switchBtnRect;
        if (x >= sb.x && x <= sb.x + sb.w && y >= sb.y && y <= sb.y + sb.h) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerSwitchCharacter();
          continue;
        }
        const fb = this.touch.followBtnRect;
        if (x >= fb.x && x <= fb.x + fb.w && y >= fb.y && y <= fb.y + fb.h) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerCompanionFollow();
          continue;
        }
      }

      // Hotbar slot tap — defer activation until touch end so long-press can open context menu
      if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
        const hi = this.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
        if (hi >= 0) {
          this.touch.inventoryDragTouchId = touch.identifier;
          this.handleMouseDown(x, y);
          this.clearInvLongPress();
          this.touch.longPressPos = { x, y };
          this.touch.longPressFired = false;
          this.touch.longPressTimer = setTimeout(() => {
            this.touch.longPressFired = true;
            this.inventoryPanel.cancelDrag();
            this.handleContextMenu(x, y);
          }, 500);
          continue;
        }
      }

      // Modal / overlay states: route as click
      if (
        this.lootBoxOpener.isOpen ||
        this._notifActive ||
        this.stairwell.menuOpen ||
        this.gameOver ||
        this.pauseMenu.isOpen ||
        this.safeRoom.mordecaiDialogOpen
      ) {
        this.handleClick(x, y);
        continue;
      }

      // Dynamite charge start: hold hotbar slot to charge, release to throw
      if (!this.gameOver && !this.pauseMenu.isOpen && this.human.isActive) {
        const dynIdx = this.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
        if (dynIdx >= 0 && this.human.inventory.hotbar[dynIdx]?.id === 'goblin_dynamite') {
          this.dynamite.beginCharge(dynIdx);
          this.touch.dynamiteTouchId = touch.identifier;
          continue;
        }
      }

      // Inventory panel drag start + long-press for context menu
      if (this.inventoryPanel.isOpen && !this.gameOver && !this.pauseMenu.isOpen) {
        if (this.inventoryPanel.hitsPanel(x, y, canvas)) {
          this.handleMouseDown(x, y);
          if (this.touch.inventoryDragTouchId === null) {
            this.touch.inventoryDragTouchId = touch.identifier;
          }
          // Start long-press timer for context menu (Drop, etc.)
          this.clearInvLongPress();
          this.touch.longPressPos = { x, y };
          this.touch.longPressFired = false;
          this.touch.longPressTimer = setTimeout(() => {
            this.touch.longPressFired = true;
            this.inventoryPanel.cancelDrag();
            this.handleContextMenu(x, y);
          }, 500);
          continue;
        }
      }

      // Game world touch: movement / tap tracking
      if (this.touch.moveTouchId === null) {
        this.touch.moveTouchId = touch.identifier;
        this.touch.moveTarget = { x, y };
        this.touch.tapStart = { x, y, time: Date.now() };
      }
    }
  }

  handleTouchMove(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Cancel long-press if finger moved too far
      if (this.touch.longPressPos) {
        const dist = Math.hypot(x - this.touch.longPressPos.x, y - this.touch.longPressPos.y);
        if (dist > 10) this.clearInvLongPress();
      }

      // Update inventory drag
      this.handleMouseMove(x, y);

      // Update movement target
      if (touch.identifier === this.touch.moveTouchId) {
        this.touch.moveTarget = { x, y };
      }
    }
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Dynamite charge release
      if (touch.identifier === this.touch.dynamiteTouchId) {
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
        this.touch.dynamiteTouchId = null;
        continue;
      }

      // Inventory / hotbar drag end
      if (touch.identifier === this.touch.inventoryDragTouchId) {
        const longPressFired = this.touch.longPressFired;
        this.clearInvLongPress();
        if (!longPressFired) {
          this.handleMouseUp(x, y);
          // Short tap on hotbar slot → activate item
          const hi = this.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
          if (hi >= 0 && !this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
            this.triggerHotbarActivation(hi);
          } else {
            // Also fire click so slot interactions (equip, context menu) work
            this.handleClick(x, y);
          }
        }
        this.touch.inventoryDragTouchId = null;
        continue;
      }

      // Game world touch end
      if (touch.identifier === this.touch.moveTouchId) {
        if (this.touch.tapStart) {
          const elapsed = Date.now() - this.touch.tapStart.time;
          const moved = Math.hypot(x - this.touch.tapStart.x, y - this.touch.tapStart.y);
          if (elapsed < 250 && moved < 20) {
            // If dynamite is charging, tap anywhere to aim and throw
            if (
              this.dynamite.isCharging &&
              this.human.isActive &&
              !this.pauseMenu.isOpen &&
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
              this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
            } else {
              // Short tap: try UI click first, then space action
              this.handleClick(x, y);
              if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
                this.triggerSpaceAction(x, y);
              }
            }
          }
        }
        this.touch.moveTouchId = null;
        this.touch.moveTarget = null;
        this.touch.tapStart = null;
      }
    }

    void canvas;
  }
}
