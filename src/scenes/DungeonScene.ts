import { SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import { platform } from '../core/Platform';
import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import { PlayerManager } from '../core/PlayerManager';
import { MobileTouchState } from '../core/MobileTouchState';
import type { LevelDef } from '../levels/types';
import { spawnForLevel, spawnExtraMobs, createMob } from '../levels/spawner';
import { getLevelDef } from '../levels';
import { PauseMenu } from '../ui/PauseMenu';
import { DeathScreen } from '../ui/DeathScreen';
import { AchievementManager } from '../core/AchievementManager';
import { AchievementUISystem } from '../systems/AchievementUISystem';
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
import { ArenaSystem } from '../systems/ArenaSystem';
import { BallOfSwine } from '../creatures/BallOfSwine';

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
import { DefendQuestSystem } from '../systems/DefendQuestSystem';
import { RenderPipeline, type RenderContext } from '../systems/RenderPipeline';
import { MobUpdateLoop } from '../systems/MobUpdateLoop';
import type { SystemContext } from '../systems/GameSystem';
import { DungeonInputHandler } from '../systems/DungeonInputHandler';
import { GameplayScene } from './GameplayScene';
import { KrakarenClone } from '../creatures/KrakarenClone';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { randomInt, pointInRect } from '../utils';
import { aiAdapter } from '../ai/AIAdapter';
import type { AISceneContext } from '../ai/aiActions';

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
  /** Called whenever the game wants to persist progress (e.g. on safe-room entry). */
  saveProgress?: (data: {
    humanSnap: PlayerSnapshot;
    catSnap: PlayerSnapshot;
    levelId: string;
  }) => void;
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
  private defendQuest!: DefendQuestSystem;
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

  // Achievement + loot box UI (notification queue, icons, opener)
  private achievementUI!: AchievementUISystem;
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;

  // Boss battle intro
  private bossIntro = new BossIntroSystem();

  // Arena (Ball of Swine) — delegated to ArenaSystem
  private arena!: ArenaSystem;

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
  private combatCooldownFrames = 0;
  private humanHealthLow = false;
  private catHealthLow = false;

  // Mouse position in screen coords (updated by handleMouseMove)
  private _mouseX = -9999;
  private _mouseY = -9999;

  private onSaveProgress:
    | ((data: { humanSnap: PlayerSnapshot; catSnap: PlayerSnapshot; levelId: string }) => void)
    | undefined;

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

    // Data-driven extra spawns (troglodytes near boss rooms, BoS at arena, sky fowls, etc.)
    this.mobs.push(...spawnExtraMobs(levelDef, this.gameMap));

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
    this.defendQuest = new DefendQuestSystem(
      this.gameMap,
      this.bus,
      () => this.mobs,
      () => this.mobGrid,
      (mob) => {
        this.mobs.push(mob);
        this.mobGrid.insert(mob);
      },
      (mob) => {
        const idx = this.mobs.indexOf(mob);
        if (idx >= 0) this.mobs.splice(idx, 1);
        this.mobGrid.remove(mob);
      },
    );
    this.arena = new ArenaSystem(
      this.gameMap,
      this.bus,
      () => this.mobs,
      () => this.mobGrid,
      (mob) => {
        this.mobs.push(mob);
        this.mobGrid.insert(mob);
      },
      this.bossRoom,
    );
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
          saveProgress: this.onSaveProgress,
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

    // Achievements — carry over from previous floor if provided
    this.humanAchievements = options?.humanAchievements ?? new AchievementManager();
    this.catAchievements = options?.catAchievements ?? new AchievementManager();

    // Achievement + loot box UI system
    this.achievementUI = new AchievementUISystem(
      this.humanAchievements,
      this.catAchievements,
      this.human,
      this.cat,
    );

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

    this.onSaveProgress = options?.saveProgress;
    this.wireEventBus();
    aiAdapter.bindScene(this.createAISceneContext(), this.bus);
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

      // Data-driven on-kill spawns (e.g. level 2 Brindle Grubs)
      if (this.levelDef.onMobKilledSpawns) {
        for (const rule of this.levelDef.onMobKilledSpawns) {
          // Don't spawn grubs from grub deaths (prevents infinite chain)
          if (mob instanceof BrindleGrub && rule.type === 'brindle_grub') continue;
          const tx = Math.round(mob.x / TILE_SIZE);
          const ty = Math.round(mob.y / TILE_SIZE);
          const count = randomInt(rule.minCount, rule.maxCount);
          for (let i = 0; i < count; i++) {
            let placed = false;
            for (let attempt = 0; attempt < 8 && !placed; attempt++) {
              const ox = Math.floor((Math.random() - 0.5) * rule.spreadRadius * 2);
              const oy = Math.floor((Math.random() - 0.5) * rule.spreadRadius * 2);
              const gtx = tx + ox;
              const gty = ty + oy;
              if (!this.gameMap.isWalkable(gtx, gty)) continue;
              const spawned = createMob(rule.type, gtx, gty, this.gameMap);
              this.mobs.push(spawned);
              this.mobGrid.insert(spawned);
              placed = true;
            }
          }
        }
      }
    });

    // ── bossDefeated: boss_slayer achievement, Krakaren → Mongo ──
    // (BoS tuskling spawning is handled by ArenaSystem via its own bus subscription)
    bus.on('bossDefeated', (e) => {
      // boss_slayer achievement for both players
      if (!this.humanAchievements.tryUnlock('boss_slayer')) {
        this.humanAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }
      if (!this.catAchievements.tryUnlock('boss_slayer')) {
        this.catAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
      }

      // Krakaren Clone death → unlock Mongo
      if (e.bossType === 'krakaren_clone' && !this.krakarenKilled) {
        this.krakarenKilled = true;
        this.mongoSystem.unlocked = true;
      }
    });

    // ── safeRoomEntered: safe_haven achievement + progress autosave ──
    bus.on('safeRoomEntered', () => {
      this.humanAchievements.tryUnlock('safe_haven');
      this.catAchievements.tryUnlock('safe_haven');
      this.onSaveProgress?.({
        humanSnap: snapPlayer(this.human),
        catSnap: snapPlayer(this.cat),
        levelId: this.levelDef.id,
      });
    });

    bus.on('questCompleted', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        const def = this.defendQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().coins += def.rewards.coins;
        }
        // Grant a loot box with quest rewards (opened in safe room)
        this.humanAchievements.grantBox('Silver', 'Adventurer', 'quest_defend_npc');
        // Clear quest items from both players' quest slots
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
    });

    bus.on('questFailed', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        // Clear quest items from both players' quest slots
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
    });
  }

  // Scene lifecycle

  onEnter(): void {
    this.inputHandler.bind({
      isSuppressed: () =>
        this.pauseMenu.isOpen ||
        this.safeRoom.isSleeping ||
        this.defendQuest.isSuppressed ||
        this.defendQuest.isDialogOpen,
      isGameOver: () => this.gameOver,
      dismissDialog: () => {
        if (this.defendQuest.dismissDialog()) return true;
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
      buildAction: () => this.triggerBuildAction(),
      hotbarActivation: (idx) => this.triggerHotbarActivation(idx),
      dynamiteRelease: (idx) => {
        if (this.dynamite.chargingHotbarIdx === idx) {
          this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
          this.bus.emit('dynamiteUsed', { player: 'Human' });
          return true;
        }
        return false;
      },
    });
  }

  onExit(): void {
    this.inputHandler.unbind();
    aiAdapter.unbindScene();
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

  private triggerBuildAction(): void {
    if (!this.human.isActive) return;
    this.defendQuest.tryBuildBarrier(this.human);
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
    if (this.defendQuest.tryInteract(active)) {
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
    const slot = active.inventory.actionBar.slots[hotbarIdx];
    if (slot?.id === 'health_potion') {
      const hpBefore = active.hp;
      if (active.usePotion()) {
        const playerName = active === this.human ? 'Human' : 'Cat';
        this.bus.emit('healingPotionUsed', {
          player: playerName,
          hpRestored: active.hp - hpBefore,
        });
      }
    } else if (slot?.abilityId === 'protective_shell') {
      this.spells.triggerProtectiveShell(this.human, this.mobGrid);
    } else if (slot?.id === 'scroll_of_confusing_fog') {
      this.spells.castConfusingFog(active);
    } else if (slot?.id === 'goblin_dynamite' && this.human.isActive) {
      if (this.dynamite.isCharging) {
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
        this.bus.emit('dynamiteUsed', { player: 'Human' });
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
    } else if (slot?.id === 'quest_wood_board' && this.human.isActive) {
      this.defendQuest.tryBuildBarrier(this.human);
    }
  }

  handleClick(mx: number, my: number): void {
    // Quest dialog clicks
    if (this.defendQuest.handleClick(mx, my)) return;

    // Achievement UI overlays (notification + loot box opener)
    if (this.achievementUI.handleClick(mx, my)) return;

    // Desktop summon button click
    if (
      !platform.isMobile &&
      !this.gameOver &&
      !this.pauseMenu.isOpen &&
      this.mongoSystem.canShow &&
      this.cat.isActive
    ) {
      const sb = this.touch.summonBtnRect;
      if (pointInRect(mx, my, sb)) {
        this.triggerMongoSummon();
        return;
      }
    }

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      if (this.achievementUI.handleAchievIconClick(mx, my)) return;
      if (this.achievementUI.handleLootBoxIconClick(mx, my, () => this.pauseMenu.close())) return;
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
        const item = active.inventory.bag.slots[slotIdx];
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

    const pb = UIRenderer.pauseButtonRect(this.sceneManager.canvas, this.miniMap);
    if (pointInRect(mx, my, pb)) {
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
    aiAdapter.update();
    this.achievementUI.tick();

    if (this.bossIntro.isActive) {
      this.bossIntro.tick();
      return;
    }

    if (
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.stairwell.menuOpen ||
      this.building?.menuOpen ||
      this.defendQuest.isDialogOpen ||
      this.defendQuest.isSuppressed
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
    this.defendQuest.renderObjects(ctx, camX, camY, this.active(), this.human);

    // Layer 2: Entities (Y-sorted mobs, players, decorations)
    this.renderPipeline.renderEntities(ctx, rc);

    // Layer 3: Effects (particles, barriers, spells, dynamite, speech bubbles)
    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) =>
      UIRenderer.renderLevelUpFlash(c, cx, cy, this.pm),
    );

    // Layer 4: Screen-space UI
    UIRenderer.renderHealthVignette(ctx, canvas, this.active(), this.gameOver);
    this.renderHUD(ctx, canvas);

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.miniMap.render(
        ctx,
        canvas,
        this.active(),
        this.inactive(),
        this.mobs,
        this.safeRoom.mordecaiPositions,
        this.defendQuest.questMarkers,
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
      UIRenderer.renderLevelTimer(ctx, canvas, this.miniMap, this.levelTimerFrames);
    }

    this.bossRoom.renderUI(ctx, canvas, camX, camY, this.mobs, this.human, this.cat);
    this.arena.render(ctx, canvas, this.active());

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
      this.defendQuest.renderUI(ctx, canvas);
      // Mongo summon button (desktop: left side above hotbar, mobile: in renderMobileButtons)
      if (!platform.isMobile && this.mongoSystem.canShow && this.cat.isActive) {
        this.touch.summonBtnRect = this.mongoSystem.renderSummonButton(
          ctx,
          10,
          canvas.height - 52 - 12 - 52 - 8,
          80,
          48,
          this.cat.isActive,
        );
      }
      if (platform.isMobile)
        UIRenderer.renderMobileButtons(ctx, canvas, this.touch, {
          human: this.human,
          cat: this.cat,
          miniMap: this.miniMap,
          companion: this.companion,
          mongoSystem: this.mongoSystem,
          inventoryPanel: this.inventoryPanel,
          gearPanel: this.gearPanel,
        });
    }

    if (this.gameOver) {
      this.deathScreen.render(ctx, canvas);
    }

    if (this.pauseMenu.isOpen) {
      const inSafe = this.human.isProtected || this.cat.isProtected;
      const onOpenHuman =
        inSafe && this.humanAchievements.pendingBoxes.length > 0
          ? () => this.achievementUI.openBoxQueue('human', () => this.pauseMenu.close())
          : undefined;
      const onOpenCat =
        inSafe && this.catAchievements.pendingBoxes.length > 0
          ? () => this.achievementUI.openBoxQueue('cat', () => this.pauseMenu.close())
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

    UIRenderer.drawPauseButton(ctx, canvas, this.miniMap, this.gameOver, this.pauseMenu.isOpen);
    this.achievementUI.drawAchievementIcon(
      ctx,
      canvas,
      this.miniMap,
      this.gameOver,
      this.pauseMenu.isOpen,
    );
    this.achievementUI.drawLootBoxIcon(ctx, canvas, this.gameOver, this.pauseMenu.isOpen);

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

    this.achievementUI.renderOverlays(ctx, canvas);

    if (this.bossIntro.isActive) {
      this.bossIntro.render(ctx, canvas);
    }

    aiAdapter.render(ctx, canvas);

    if (
      platform.showEntityTooltip &&
      !this.gameOver &&
      !this.pauseMenu.isOpen &&
      !this.achievementUI.isBlocking
    ) {
      UIRenderer.renderEntityTooltip(
        ctx,
        canvas,
        camX,
        camY,
        this._mouseX,
        this._mouseY,
        this.mobs,
      );
    }
  }

  // Core gameplay update

  private buildSystemContext(): SystemContext {
    const active = this.active();
    return {
      human: this.human,
      cat: this.cat,
      active,
      inactive: this.inactive(),
      activeIsMoving: active.isMoving,
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      gameMap: this.gameMap,
      bossRoom: this.bossRoom,
      extraTargets: (() => {
        const targets: import('../Player').Player[] = [];
        if (this.mongoSystem.mongo) targets.push(this.mongoSystem.mongo);
        const npc = this.defendQuest.questNPC;
        if (npc && npc.isAlive) targets.push(npc);
        return targets.length > 0 ? targets : undefined;
      })(),
    };
  }

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

    // Build shared context once — passed to every system update
    const ctx = this.buildSystemContext();

    this.safeRoom.update(ctx);
    this.bossRoom.update(ctx);

    // Arena system: door locking, phase transitions, stairwell unlock
    this.arena.update(ctx);

    // Trigger boss battle intro on first room entry
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

    this.barriers.update(ctx);
    this.defendQuest.update(ctx);

    // Juicer room gym pickups + Juicer AI coordination
    this.juicerRoom.update(ctx);

    this.companion.update(ctx);

    this.human.updateAttack();
    this.cat.updateMissiles();

    // Spell system (resets confusion, ticks fogs/shell)
    this.spells.update(ctx);

    // Mob AI tick (activation radius, pathfinding, boss clamping)
    this.mobLoop.update(ctx);

    const combatCtx: CombatContext = {
      human: this.human,
      cat: this.cat,
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      gameMap: this.gameMap,
      safeRoom: this.safeRoom,
      bus: this.bus,
      hitLanded: false,
    };
    resolvePlayerAttacks(combatCtx);

    if (combatCtx.hitLanded) {
      if (this.combatCooldownFrames <= 0) {
        const hitMob = this.mobs.find((m) => m.isAlive && m.damageTakenBy.size > 0);
        this.bus.emit('combatStarted', {
          attacker: this.human.isActive ? 'Human' : 'Cat',
          mobType: hitMob?.constructor.name ?? 'Unknown',
        });
      }
      this.combatCooldownFrames = 300;
    } else if (this.combatCooldownFrames > 0) {
      this.combatCooldownFrames--;
    }

    for (const [player, name] of [
      [this.human, 'Human'],
      [this.cat, 'Cat'],
    ] as const) {
      const isLow = player.hp / player.maxHp < 0.25;
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

    // Intercept Mongo lethal damage before resolveKills consumes justDied
    this.mongoSystem.checkHealth();

    // resolveKills emits mobKilled → listeners handle gore, loot, achievements,
    // grub spawns, BoS tuskling burst, Krakaren → Mongo unlock
    resolveKills(combatCtx);

    // Update Mongo system (cooldown, recall, despawn)
    this.mongoSystem.update(ctx);

    this.pm.tickTimers();

    this.playerTick.update(ctx);

    this.loot.update(ctx);

    this.speechBubblePulse++;

    this.gore.update();
    this.dynamite.update(ctx);

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

  // Inventory actions

  private resolvePendingInventoryAction(active: HumanPlayer | CatPlayer): void {
    if (this.inventoryPanel.interaction.pendingEquipSlot !== null) {
      const slotIdx = this.inventoryPanel.interaction.pendingEquipSlot;
      this.inventoryPanel.interaction.pendingEquipSlot = null;
      const item = active.inventory.bag.slots[slotIdx];
      if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
        const prev = active.inventory.equip(slotIdx);
        if (prev) active.removeItemBonus(prev);
        active.applyItemBonus(item);
      }
    }

    if (this.inventoryPanel.interaction.pendingUnequipSlot !== null) {
      const slotIdx = this.inventoryPanel.interaction.pendingUnequipSlot;
      this.inventoryPanel.interaction.pendingUnequipSlot = null;
      const item = active.inventory.bag.slots[slotIdx];
      if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
        active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
        active.removeItemBonus(item);
      }
    }

    if (this.inventoryPanel.interaction.pendingDropItem !== null) {
      const { id, quantity } = this.inventoryPanel.interaction.pendingDropItem;
      this.inventoryPanel.interaction.pendingDropItem = null;
      if (active.inventory.hasEquipped(id)) {
        const item =
          active.inventory.bag.slots.find((s) => s?.id === id) ??
          active.inventory.actionBar.slots.find((s) => s?.id === id) ??
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

  // AI integration

  private createAISceneContext(): AISceneContext {
    return {
      getHuman: () => this.human,
      getCat: () => this.cat,
      getMobs: () => this.mobs,
      getGameMap: () => this.gameMap,
      getLevelId: () => this.levelDef.id,
      spawnMob: (mob) => {
        this.mobs.push(mob);
        this.mobGrid.insert(mob);
      },
    };
  }

  // Camera

  private camera(): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const camX = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const camY = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x: clamp(camX, 0, mapPx - canvas.width),
      y: clamp(camY, 0, mapPx - canvas.height),
    };
  }

  // Touch handlers (mobile)

  handleTouchStart(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // HUD collapse/expand toggle (mobile only)
      if (platform.isMobile) {
        const ht = this._hudToggleRect;
        if (pointInRect(x, y, ht)) {
          this._hudCollapsed = !this._hudCollapsed;
          continue;
        }
      }

      // Minimap tap to expand/collapse (mobile only)
      if (platform.isMobile && !this.gameOver && !this.pauseMenu.isOpen) {
        const mm = this.touch.miniMapRect;
        if (pointInRect(x, y, mm)) {
          this.miniMap.toggle();
          continue;
        }
      }

      // Gear / Bag buttons (mobile only)
      if (platform.isMobile && !this.gameOver && !this.pauseMenu.isOpen) {
        const gb = this.touch.gearBtnRect;
        if (pointInRect(x, y, gb)) {
          this.gearPanel.toggle();
          continue;
        }
        const bb = this.touch.bagBtnRect;
        if (pointInRect(x, y, bb)) {
          this.inventoryPanel.toggle();
          continue;
        }
      }

      // Mobile Mongo summon button
      if (platform.isMobile && this.mongoSystem.canShow && this.cat.isActive) {
        const mb = this.touch.summonBtnRect;
        if (pointInRect(x, y, mb)) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerMongoSummon();
          continue;
        }
      }

      // Mobile action buttons (always checked first)
      if (platform.isMobile) {
        const sb = this.touch.switchBtnRect;
        if (pointInRect(x, y, sb)) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerSwitchCharacter();
          continue;
        }
        const fb = this.touch.followBtnRect;
        if (pointInRect(x, y, fb)) {
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
        this.achievementUI.isBlocking ||
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
        if (dynIdx >= 0 && this.human.inventory.actionBar.slots[dynIdx]?.id === 'goblin_dynamite') {
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
        const wasCharging = this.dynamite.isCharging;
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
        if (wasCharging) this.bus.emit('dynamiteUsed', { player: 'Human' });
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
              const wasCharging = this.dynamite.isCharging;
              this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
              if (wasCharging) this.bus.emit('dynamiteUsed', { player: 'Human' });
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
