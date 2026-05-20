import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { platform } from '../core/Platform';
import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { GameMap } from '../map/GameMap';
import { type HumanPlayer } from '../creatures/HumanPlayer';
import { type CatPlayer } from '../creatures/CatPlayer';
import { type Mob, type LootDrop } from '../creatures/Mob';
import type { Player } from '../Player';
import { PlayerManager } from '../core/PlayerManager';
import { MobileTouchState } from '../core/MobileTouchState';
import type { LevelDef } from '../levels/types';
import { spawnForLevel, spawnExtraMobs, createMob, spawnTreasureRoomMobs } from '../levels/spawner';
import { getLevelDef } from '../levels';
import { PauseMenu } from '../ui/PauseMenu';
import { DeathScreen } from '../ui/DeathScreen';
import { LevelCompleteScreen } from '../ui/LevelCompleteScreen';
import { AchievementManager } from '../core/AchievementManager';
import { AchievementUISystem } from '../systems/AchievementUISystem';
import { InventoryPanel } from '../ui/InventoryPanel';
import { GearPanel } from '../ui/GearPanel';
import { SpatialGrid } from '../core/SpatialGrid';

import { MiniMapSystem } from '../systems/MiniMapSystem';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BossRoomSystem, BOSS_META } from '../systems/BossRoomSystem';
import { drawHUD, renderMobileSkillBadge } from '../ui/HUD';
import { DynamiteSystem } from '../systems/DynamiteSystem';
import { SpellSystem } from '../systems/SpellSystem';
import { CompanionSystem } from '../systems/CompanionSystem';
import { LootSystem } from '../systems/LootSystem';
import { StairwellSystem } from '../systems/StairwellSystem';
import { BuildingSystem } from '../systems/BuildingSystem';
import { JuicerRoomSystem } from '../systems/JuicerRoomSystem';
import { BarrierSystem } from '../systems/BarrierSystem';
import { ArenaSystem } from '../systems/ArenaSystem';
import { TreasureChestSystem } from '../systems/TreasureChestSystem';
import { ChestRewardDialog } from '../ui/ChestRewardDialog';
import { BallOfSwine } from '../creatures/BallOfSwine';

import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { BossIntroSystem } from '../systems/BossIntroSystem';
import { DungeonIntroSystem } from '../systems/DungeonIntroSystem';
import { resolvePlayerAttacks, resolveKills, type CombatContext } from '../systems/CombatSystem';
import { AbilityManager } from '../core/AbilityManager';
import type { AbilityId, AbilityState } from '../core/AbilityManager';
import { FollowerMenu } from '../systems/FollowerMenu';
import { MAGIC_MISSILE_DEF } from '../abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from '../abilities/protectiveShell';
import { SMUSH_DEF } from '../abilities/smush';
import { AbilityLevelUpDialog } from '../ui/AbilityLevelUpDialog';
import { GoreSystem } from '../systems/GoreSystem';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { EventBus } from '../core/EventBus';
import { PlayerTickSystem } from '../systems/PlayerTickSystem';
import { readMovement, applyMovement, checkDeath, revealMinimap } from '../systems/GameLoopPhases';
import { BuildingInteriorScene } from './BuildingInteriorScene';
import { MongoSystem } from '../systems/MongoSystem';
import { DefendQuestSystem } from '../systems/DefendQuestSystem';
import { SpiderQuestSystem } from '../systems/SpiderQuestSystem';
import { RenderPipeline, type RenderContext } from '../systems/RenderPipeline';
import { MobUpdateLoop } from '../systems/MobUpdateLoop';
import type { SystemContext } from '../systems/GameSystem';
import { DungeonInputHandler } from '../systems/DungeonInputHandler';
import { GameplayScene } from './GameplayScene';
import { KrakarenClone } from '../creatures/KrakarenClone';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { SmallSpider } from '../creatures/SmallSpider';
import { TheHoarder } from '../creatures/TheHoarder';
import { Juicer } from '../creatures/Juicer';
import {
  GrotesqueSpider,
  SLAM_AUDIO_OFFSET,
  SCREECH_AUDIO_OFFSET,
} from '../creatures/GrotesqueSpider';
import { randomInt, pointInRect } from '../utils';
import { makeElectrified } from '../core/StatusEffect';
import { aiAdapter } from '../ai/AIAdapter';
import type { AISceneContext } from '../ai/aiActions';
import { PlayerChatSystem } from '../systems/PlayerChatSystem';
import { GameStats } from '../core/GameStats';
import type { AudioManager } from '../audio/AudioManager';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import {
  setButtonMouseState,
  setButtonAudio,
  notifyButtonClick,
  clearButtonMouseState,
} from '../ui/Button';

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
  /** Carry ability leveling progress across floor transitions. */
  abilityManager?: AbilityManager;
  /** Ability state at floor entry — restored on death-restart so level-up progress rewinds to floor-start. */
  floorEntryAbilityManager?: AbilityManager;
  /** Called whenever the game wants to persist progress (e.g. on safe-room entry). */
  saveProgress?: (data: {
    humanSnap: PlayerSnapshot;
    catSnap: PlayerSnapshot;
    levelId: string;
  }) => void;
  /** Shared AudioManager instance — persists across scene transitions. */
  audio?: AudioManager;
}

/** Find a walkable tile at least minTileDist tiles from (fromTileX, fromTileY), anywhere on the map. */
function findFarSpawnTile(
  map: GameMap,
  fromTileX: number,
  fromTileY: number,
  minTileDist: number,
): { tx: number; ty: number } | null {
  const rows = map.structure.length;
  const cols = map.structure[0]?.length ?? rows;
  for (let attempt = 0; attempt < 400; attempt++) {
    const tx = Math.floor(Math.random() * (cols - 2)) + 1;
    const ty = Math.floor(Math.random() * (rows - 2)) + 1;
    if (!map.isWalkable(tx, ty)) continue;
    if (Math.hypot(tx - fromTileX, ty - fromTileY) < minTileDist) continue;
    return { tx, ty };
  }
  return null;
}

// Items with a designated owner — kept in sync with non-boss floor loot routing below
const FORCED_TO_HUMAN = new Set<string>(['trollskin_shirt']);
const FORCED_TO_CAT = new Set<string>(['enchanted_crown_sepsis_whore']);

function splitChestLoot(loot: LootDrop): { humanLoot: LootDrop; catLoot: LootDrop } {
  const humanItems: LootDrop['items'] = [];
  const catItems: LootDrop['items'] = [];
  const singlePool: LootDrop['items'] = [];

  for (const item of loot.items) {
    if (FORCED_TO_HUMAN.has(item.id)) {
      humanItems.push({ ...item });
    } else if (FORCED_TO_CAT.has(item.id)) {
      catItems.push({ ...item });
    } else if (item.quantity === 1) {
      singlePool.push({ ...item });
    } else {
      // Split stacks evenly; extra goes to random player
      const half = Math.floor(item.quantity / 2);
      const extra = item.quantity - half * 2;
      const humanGetsExtra = extra > 0 && Math.random() < 0.5;
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
  const humanGetsExtraCoin = extraCoin > 0 && Math.random() < 0.5;

  return {
    humanLoot: { coins: halfCoins + (humanGetsExtraCoin ? extraCoin : 0), items: humanItems },
    catLoot: { coins: halfCoins + (humanGetsExtraCoin ? 0 : extraCoin), items: catItems },
  };
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
  private spiderQuest!: SpiderQuestSystem;
  private _spiderKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private gore = new GoreSystem();
  private bodyPartGore = new BodyPartGoreSystem();
  private playerTick = new PlayerTickSystem();
  private mongoSystem = new MongoSystem();
  private renderPipeline = new RenderPipeline();
  private mobLoop = new MobUpdateLoop();
  private bus = new EventBus();

  protected pauseMenu: PauseMenu;
  private deathScreen: DeathScreen;
  private levelCompleteScreen = new LevelCompleteScreen();
  private inventoryPanel: InventoryPanel;
  private gearPanel: GearPanel;
  /** When set, the inventory panel shows this player's inventory instead of the active player's. */
  private _inventoryOverridePlayer: HumanPlayer | CatPlayer | null = null;

  private achievementUI!: AchievementUISystem;
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;

  private bossIntro = new BossIntroSystem();
  private readonly dungeonIntro = new DungeonIntroSystem();
  // Becomes true once the AudioContext is running so intro ticks in sync with sound.
  private introStarted = false;

  private readonly abilityManager: AbilityManager;
  private readonly abilityLevelUpDialog: AbilityLevelUpDialog;

  private arena!: ArenaSystem;
  private readonly treasureChests = new TreasureChestSystem();
  private readonly chestRewardDialog = new ChestRewardDialog();

  private floorEntryHumanSnap!: PlayerSnapshot;
  private floorEntryCatSnap!: PlayerSnapshot;
  private floorEntryHumanAchievements!: AchievementManager;
  private floorEntryCatAchievements!: AchievementManager;
  private floorEntryAbilityManager!: AbilityManager;

  private readonly followerMenu = new FollowerMenu();

  private _godModeSnapshot: null | {
    human: {
      strength: number;
      intelligence: number;
      constitution: number;
      maxHp: number;
      speedMultiplier: number;
    };
    cat: {
      strength: number;
      intelligence: number;
      constitution: number;
      maxHp: number;
      speedMultiplier: number;
    };
    abilityLevels: Map<AbilityId, AbilityState>;
  } = null;

  private _toughModeActive = false;
  private _revealStairwell = false;
  private _revealSpiderLab = false;

  private gameOver = false;
  protected readonly notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  private readonly LEVEL_TIME_LIMIT = 216_000; // 1 hour @ 60 fps
  private wasInSafeRoom = false;
  private speechBubblePulse = 0;

  private readonly inputHandler = new DungeonInputHandler();
  private readonly playerChat = new PlayerChatSystem();

  private readonly touch = new MobileTouchState();
  private krakarenKilled = false;
  private woodBreakSoundIdx = 0;
  private combatCooldownFrames = 0;
  private humanHealthLow = false;
  private catHealthLow = false;
  private playerIdleFrames = 0;
  private gameStats = new GameStats();

  private _mouseX = -9999;
  private _mouseY = -9999;
  private _mouseDown = false;
  private _miniMapDragging = false;
  private _miniMapDragLastX = 0;
  private _miniMapDragLastY = 0;

  private onSaveProgress:
    | ((data: { humanSnap: PlayerSnapshot; catSnap: PlayerSnapshot; levelId: string }) => void)
    | undefined;

  private readonly audio: AudioManager | null;

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
        hasSpiderLab: levelDef.hasSpiderLab ?? false,
      });
    this.levelTimerFrames = levelDef.isSafeLevel ? 0 : this.LEVEL_TIME_LIMIT;

    const spawn = options?.spawnAt ?? this.gameMap.startTile;
    const { x: sx, y: sy } = spawn;
    this.pm = new PlayerManager(sx, sy);

    if (options?.humanSnap) restorePlayer(this.human, options.humanSnap);
    if (options?.catSnap) restorePlayer(this.cat, options.catSnap);
    this.pm.setPositions(sx, sy);

    this.floorEntryHumanSnap = options?.floorEntryHumanSnap ?? snapPlayer(this.human);
    this.floorEntryCatSnap = options?.floorEntryCatSnap ?? snapPlayer(this.cat);

    this.mobs = spawnForLevel(levelDef, this.gameMap);
    this.mobs.push(...spawnExtraMobs(levelDef, this.gameMap));

    // Treasure room mobs (extra enemies guarding wooden chests)
    if (!levelDef.isSafeLevel && !levelDef.isOverworld) {
      const treasureMobs = spawnTreasureRoomMobs(
        this.gameMap.treasureRooms,
        levelDef,
        this.gameMap,
      );
      this.mobs.push(...treasureMobs);
    }

    if (!levelDef.isSafeLevel && !levelDef.isOverworld) {
      const spiderTile = findFarSpawnTile(this.gameMap, sx, sy, 60);
      if (spiderTile) {
        const spider = new GrotesqueSpider(spiderTile.tx, spiderTile.ty, TILE_SIZE);
        spider.setMap(this.gameMap);
        this.mobs.push(spider);
      }
    }

    this.cat.setMap(this.gameMap);

    this.mobGrid = new SpatialGrid<Mob>(TILE_SIZE * 4);
    for (const mob of this.mobs) this.mobGrid.insert(mob);

    this.miniMap = new MiniMapSystem(this.gameMap);
    this.safeRoom = new SafeRoomSystem(this.gameMap, sx, sy, this.levelDef.id);
    this.bossRoom = new BossRoomSystem(
      this.gameMap,
      this.miniMap,
      levelDef.bossRooms?.map((b) => b.type) ?? [],
    );
    this.juicerRoom = new JuicerRoomSystem(this.gameMap.bossRooms[1]?.bounds);
    this.barriers = new BarrierSystem(this.gameMap);
    this.defendQuest = new DefendQuestSystem(this.gameMap, this.bus, (mob) => {
      this.mobs.push(mob);
      this.mobGrid.insert(mob);
      mob.setSpells(this.spells);
    });
    this.spiderQuest = new SpiderQuestSystem(this.gameMap, (mob) => {
      this.mobs.push(mob);
      this.mobGrid.insert(mob);
      mob.setSpells(this.spells);
    });
    this.arena = new ArenaSystem(
      this.gameMap,
      this.bus,
      () => this.mobs,
      (mob) => {
        this.mobs.push(mob);
        this.mobGrid.insert(mob);
        mob.setSpells(this.spells);
      },
      this.bossRoom,
    );
    this.dynamite = new DynamiteSystem(this.gameMap);
    this.spells = new SpellSystem();
    for (const mob of this.mobs) mob.setSpells(this.spells);
    this.companion = new CompanionSystem(this.gameMap, sx, sy);
    this.followerMenu.onFollowMe = () => {
      this.audio?.play('menu_change_follower');
      this.companion.setFollowMe(this.human.isActive);
      this.inactive().autoTarget = null;
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
    this.loot = new LootSystem(this.gameMap);
    this.stairwell = new StairwellSystem(this.gameMap, levelDef, () => {
      if (!levelDef.nextLevelId) return;

      // Save progress immediately so the floor is recorded as complete even if
      // the player closes the browser during the celebration screen.
      this.onSaveProgress?.({
        humanSnap: this._cleanSnapFor(this.human),
        catSnap: this._cleanSnapFor(this.cat),
        levelId: levelDef.nextLevelId,
      });

      this.bus.emit('levelComplete', {});

      const nextDef = getLevelDef(levelDef.nextLevelId);
      this.levelCompleteScreen.activate(levelDef.name, nextDef.name, () => {
        // Dismiss Mongo before floor transition
        this.mongoSystem.dismiss(this.mobs, this.mobGrid);
        this.sceneManager.replace(
          new DungeonScene(nextDef, this.input, this.sceneManager, {
            humanSnap: this._cleanSnapFor(this.human),
            catSnap: this._cleanSnapFor(this.cat),
            humanAchievements: this.humanAchievements,
            catAchievements: this.catAchievements,
            mongoUnlocked: this.mongoSystem.unlocked,
            abilityManager: this._cleanAbilityManager(),
            saveProgress: this.onSaveProgress,
            audio: this.audio ?? undefined,
          }),
        );
      });
    });

    if (levelDef.isOverworld) {
      this.building = new BuildingSystem(this.gameMap, (entry) => {
        // Spawn one tile south of the door so the player exits outside and
        // doesn't immediately re-trigger the "Enter building?" prompt.
        const returnTile = {
          x: entry.doorTile.x,
          y: entry.doorTile.y + 1,
        };
        const humanSnap = this._cleanSnapFor(this.human);
        const catSnap = this._cleanSnapFor(this.cat);
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
                  audio: this.audio ?? undefined,
                }),
              );
            },
            this.humanAchievements,
            this.catAchievements,
            this.audio ?? undefined,
          ),
        );
      });
    }

    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
    this.inventoryPanel = new InventoryPanel();
    this.gearPanel = new GearPanel();

    this.humanAchievements = options?.humanAchievements ?? new AchievementManager();
    this.catAchievements = options?.catAchievements ?? new AchievementManager();

    this.achievementUI = new AchievementUISystem(
      this.humanAchievements,
      this.catAchievements,
      this.human,
      this.cat,
      options?.audio ?? null,
    );

    this.floorEntryHumanAchievements =
      options?.floorEntryHumanAchievements ?? this.humanAchievements.clone();
    this.floorEntryCatAchievements =
      options?.floorEntryCatAchievements ?? this.catAchievements.clone();

    if (options?.mongoUnlocked) {
      this.mongoSystem.unlocked = true;
    }

    this.abilityManager = options?.abilityManager ?? new AbilityManager();
    this.abilityManager.register(MAGIC_MISSILE_DEF);
    this.abilityManager.register(PROTECTIVE_SHELL_DEF);
    this.abilityManager.register(SMUSH_DEF);
    this.floorEntryAbilityManager =
      options?.floorEntryAbilityManager ?? this.abilityManager.clone();
    this.abilityLevelUpDialog = new AbilityLevelUpDialog(this.abilityManager);
    this.abilityManager.onLevelUp = (id, newLevel) => {
      this.abilityLevelUpDialog.enqueue(id, newLevel);
      this.audio?.play('ability_level_up');
    };
    this.cat.setAbilityManager(this.abilityManager);
    this.human.setAbilityManager(this.abilityManager);

    this.onSaveProgress = options?.saveProgress;
    this.audio = options?.audio ?? null;
    this.pauseMenu.audio = this.audio;
    this.pauseMenu.onOpenChat = () => {
      this.pauseMenu.close();
      this.triggerOpenChat();
    };

    const openInventoryFor = (player: HumanPlayer | CatPlayer) => {
      this.pauseMenu.close();
      this._inventoryOverridePlayer = player;
      this.inventoryPanel.isOpen = true;
      this.inventoryPanel.returnToMenuCallback = () => {
        this._inventoryOverridePlayer = null;
        this.inventoryPanel.isOpen = false;
        this.pauseMenu.openToInventory();
      };
    };
    this.pauseMenu.onManageHumanInventory = () => openInventoryFor(this.human);
    this.pauseMenu.onManageCatInventory = () => openInventoryFor(this.cat);

    this.inventoryPanel.onClose = () => {
      this._inventoryOverridePlayer = null;
    };

    this.deathScreen.audio = this.audio;
    this.abilityLevelUpDialog.audio = this.audio;

    // Boss chests — placed 2 tiles above each boss room centre
    this.gameMap.bossRooms.forEach((br, i) => {
      const cx = br.centre.x;
      const cy = br.centre.y - 2;
      this.treasureChests.addBossChest(cx, cy, i);
      this.gameMap.blockTilePermanently(cx, cy);
    });

    // Wooden chests for treasure rooms
    for (const tr of this.gameMap.treasureRooms) {
      const coins = randomInt(15, 50);
      const items: Array<{ id: 'health_potion' | 'scroll_of_confusing_fog'; quantity: number }> =
        [];
      const roll = Math.random();
      if (roll < 0.4) {
        items.push({ id: 'health_potion', quantity: randomInt(1, 2) });
      } else if (roll < 0.6) {
        items.push({ id: 'scroll_of_confusing_fog', quantity: 1 });
      }
      this.treasureChests.addWoodenChest(tr.centre.x, tr.centre.y, tr.bounds, {
        coins,
        items,
      });
      this.gameMap.blockTilePermanently(tr.centre.x, tr.centre.y);
    }

    // Wire chest opened callback
    this.treasureChests.setOnOpen((chest) => {
      const split = chest.loot !== null ? splitChestLoot(chest.loot) : null;
      if (split !== null) {
        for (const item of split.humanLoot.items) {
          this.human.inventory.addItem(item.id, item.quantity);
        }
        this.human.coins += split.humanLoot.coins;
        for (const item of split.catLoot.items) {
          this.cat.inventory.addItem(item.id, item.quantity);
        }
        this.cat.coins += split.catLoot.coins;
      }
      this.chestRewardDialog.open(chest, split);
      this.audio?.play('opening_treasure_chest');
    });

    this.treasureChests.setOnLockedAttempt(() => {
      this.audio?.play('chest_locked');
    });
    this.treasureChests.setOnWoodenChestUnlocked(() => {
      this.audio?.play('chest_unlocked_in_treasure_room');
    });

    this.spawnArenaEquipment();
    this.wireEventBus();
    aiAdapter.bindScene(this.createAISceneContext(), this.bus);
  }

  private spawnArenaEquipment(): void {
    if (this.gameMap.arenaExteriors.length === 0) return;
    const arena = this.gameMap.arenaExteriors[0];
    const door = arena.doorTile;
    // Arena door is always at the south end (doorY = centreY + radius).
    // Place gym items inside the arena near the entrance so players can
    // collect and place barriers before the BoS fight starts.
    const candidates: Array<{
      x: number;
      y: number;
      id: 'gym_dumbbell' | 'gym_bench_press' | 'gym_treadmill';
    }> = [
      { x: door.x - 2, y: door.y - 3, id: 'gym_dumbbell' },
      { x: door.x + 1, y: door.y - 3, id: 'gym_dumbbell' },
      { x: door.x - 2, y: door.y - 6, id: 'gym_dumbbell' },
      { x: door.x + 1, y: door.y - 6, id: 'gym_dumbbell' },
      { x: door.x - 1, y: door.y - 9, id: 'gym_bench_press' },
      { x: door.x, y: door.y - 12, id: 'gym_treadmill' },
    ];
    for (const { x, y, id } of candidates) {
      if (this.gameMap.isWalkable(x, y)) {
        this.loot.addLoot(
          x * TILE_SIZE,
          y * TILE_SIZE,
          { coins: 0, items: [{ id, quantity: 1 }] },
          this.human,
          true,
        );
      }
    }
  }

  private wireEventBus(): void {
    const bus = this.bus;

    bus.on('spawnGore', (e) => {
      this.gore.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });

    // ── stats tracking ──
    bus.on('mobKilled', (e) => this.gameStats.recordKill(e.mob.displayName));
    bus.on('healingPotionUsed', () => this.gameStats.recordPotionUsed());

    // ── mobKilled: corpse marker, achievements, loot, grub spawns ──
    bus.on('mobKilled', (e) => {
      const { mob, killer, topDamageDealer } = e;
      const cx = mob.x + TILE_SIZE * 0.5;
      const cy = mob.y + TILE_SIZE * 0.5;

      let impactDx = 0;
      let impactDy = 0;
      if (killer !== null) {
        const dx = cx - (killer.x + TILE_SIZE * 0.5);
        const dy = cy - (killer.y + TILE_SIZE * 0.5);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          impactDx = dx / dist;
          impactDy = dy / dist;
        }
      }

      bus.emit('spawnGore', { x: cx, y: cy, impactDx, impactDy });
      this.bodyPartGore.spawnParts(cx, cy, mob.bodyPartKey, TILE_SIZE, impactDx, impactDy);
      this.miniMap.addCorpseMarker(cx, cy);

      if (killer === this.human && this.humanAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Human' });
      }
      if (killer === this.cat && this.catAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Cat' });
      }

      if (killer === this.human && (mob.killType === 'melee' || mob.killType === 'smush')) {
        if (this.humanAchievements.tryUnlock('smush')) {
          bus.emit('achievementUnlocked', { achievementId: 'smush', player: 'Human' });
        }
      }

      if (killer === this.cat && mob.killType === 'missile') {
        if (this.catAchievements.tryUnlock('magic_touch')) {
          bus.emit('achievementUnlocked', { achievementId: 'magic_touch', player: 'Cat' });
        }
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
          if (bossRoomIdx >= 0) {
            this.treasureChests.receiveBossLoot(bossRoomIdx, mob.droppedLoot);
          } else {
            // Fallback: drop normally if no matching boss room
            if (mob.droppedLoot.coins > 0 || mob.droppedLoot.items.length > 0) {
              this.loot.addLoot(cx, cy, mob.droppedLoot, topDamageDealer, true);
            }
          }
        } else {
          const mainItems = mob.droppedLoot.items.filter(
            (it) => !FORCED_TO_HUMAN.has(it.id) && !FORCED_TO_CAT.has(it.id),
          );
          const humanItems = mob.droppedLoot.items.filter((it) => FORCED_TO_HUMAN.has(it.id));
          const catItems = mob.droppedLoot.items.filter((it) => FORCED_TO_CAT.has(it.id));
          if (mainItems.length > 0 || mob.droppedLoot.coins > 0) {
            this.loot.addLoot(
              cx,
              cy,
              { coins: mob.droppedLoot.coins, items: mainItems },
              topDamageDealer,
              false,
            );
          }
          if (humanItems.length > 0) {
            this.loot.addLoot(cx, cy, { coins: 0, items: humanItems }, this.human, false);
          }
          if (catItems.length > 0) {
            this.loot.addLoot(cx, cy, { coins: 0, items: catItems }, this.cat, false);
          }
        }
        mob.droppedLoot = null;
      }

      if (mob.isBoss) {
        bus.emit('bossDefeated', {
          bossType: mob.constructor.name || 'unknown',
          mob,
        });
      }

      if (mob instanceof BallOfSwine) {
        bus.emit('bossDefeated', { bossType: 'ball_of_swine', mob });
      }

      if (mob instanceof KrakarenClone) {
        bus.emit('bossDefeated', { bossType: 'krakaren_clone', mob });
      }

      if (this.levelDef.onMobKilledSpawns) {
        for (const rule of this.levelDef.onMobKilledSpawns) {
          if (mob instanceof BrindleGrub && rule.type === 'brindle_grub') continue;
          if (mob instanceof SmallSpider) continue;
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

    bus.on('bossDefeated', (e) => {
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
      const bossLabel = `Defeated boss: ${e.bossType.replace(/_/g, ' ')}`;
      this.humanAchievements.logRecentEvent(bossLabel);
      this.catAchievements.logRecentEvent(bossLabel);

      if (e.bossType === 'krakaren_clone' && !this.krakarenKilled) {
        this.krakarenKilled = true;
        this.mongoSystem.unlocked = true;
      }
    });

    bus.on('playerLevelUp', (e) => {
      const isHuman = e.player === this.human;
      const who = isHuman ? 'Human' : 'Cat';
      const mgr = isHuman ? this.humanAchievements : this.catAchievements;
      mgr.logRecentEvent(`${who} reached level ${e.newLevel}`);
    });

    bus.on('safeRoomEntered', () => {
      if (this.humanAchievements.tryUnlock('safe_haven')) {
        bus.emit('achievementUnlocked', { achievementId: 'safe_haven', player: 'Human' });
      }
      if (this.catAchievements.tryUnlock('safe_haven')) {
        bus.emit('achievementUnlocked', { achievementId: 'safe_haven', player: 'Cat' });
      }
      this.onSaveProgress?.({
        humanSnap: this._cleanSnapFor(this.human),
        catSnap: this._cleanSnapFor(this.cat),
        levelId: this.levelDef.id,
      });
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
    });

    bus.on('questFailed', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
    });

    this.audio?.wireEvents(bus);
  }

  onEnter(): void {
    this.audio?.resume();
    // Delay intro ticking until the AudioContext is running so the intro sound
    // plays in sync with the visual. On desktop this is nearly instant; on mobile
    // it waits for the first user gesture and shows a "Tap to begin" prompt.
    const startIntro = (): void => {
      this.introStarted = true;
      this.audio?.playWhenReady('level_begins');
      this.audio?.playMusic('bg_level_1', { fadeInMs: 2000 });
    };
    if (this.audio === null || this.audio.isRunning) {
      startIntro();
    } else {
      this.audio.onRunning(startIntro);
    }

    this._spiderKeyHandler = (e: KeyboardEvent) => {
      this.spiderQuest.handleKeyDown(e.key);
    };
    window.addEventListener('keydown', this._spiderKeyHandler);

    this.inputHandler.bind({
      isSuppressed: () =>
        this.pauseMenu.isOpen ||
        this.followerMenu.isOpen ||
        this.safeRoom.isSleeping ||
        this.defendQuest.isDialogOpen ||
        this.spiderQuest.isDialogOpen ||
        this.playerChat.isOpen,
      isGameOver: () => this.gameOver,
      dismissChestDialog: () => this.chestRewardDialog.handleKeyDown(),
      dismissDialog: () => {
        if (this.playerChat.isOpen) {
          this.playerChat.cancel();
          return true;
        }
        if (this.defendQuest.dismissDialog()) return true;
        if (this.spiderQuest.dismissDialog()) return true;
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
      dismissFollowerMenu: () => {
        if (this.followerMenu.isOpen) {
          this.followerMenu.close();
          return true;
        }
        return false;
      },
      togglePause: () => {
        this.pauseMenu.toggle();
        if (this.pauseMenu.isOpen) this.audio?.play('menu_open');
        else this.input.clear();
      },
      clearInput: () => this.input.clear(),
      advanceDialog: () => this.defendQuest.advancePage(),
      switchCharacter: () => this.triggerSwitchCharacter(),
      spaceAction: () => this.triggerSpaceAction(),
      usePotion: () => {
        const active = this.human.isActive ? this.human : this.cat;
        if (active.potionCooldownFrames > 0) {
          this.audio?.play('error_taking_action');
          return;
        }
        const hpBefore = active.hp;
        if (active.usePotion()) {
          this.bus.emit('healingPotionUsed', {
            player: active === this.human ? 'Human' : 'Cat',
            hpRestored: active.hp - hpBefore,
          });
        }
      },
      toggleInventory: () => this.inventoryPanel.toggle(),
      toggleGear: () => this.gearPanel.toggle(),
      companionFollow: () => this.triggerCompanionFollow(),
      toggleMiniMap: () => {
        this.miniMap.toggle();
        this.audio?.play('menu_expand_map');
      },
      openChat: () => this.triggerOpenChat(),
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
    this.audio?.stopWalkingLoop();
    this.audio?.stopMachineryLoop();
    this.audio?.stopMusic();
    this.inputHandler.unbind();
    if (this._spiderKeyHandler !== null) {
      window.removeEventListener('keydown', this._spiderKeyHandler);
      this._spiderKeyHandler = null;
    }
    this.spiderQuest.dispose();
    aiAdapter.unbindScene();
    this.bus.clear();
  }

  private triggerSwitchCharacter(): void {
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

  private readonly REVIVE_RANGE_PX = TILE_SIZE * 0.8;
  private readonly REVIVE_FRAMES = 300; // 5 seconds @ 60fps

  /**
   * Detects when the inactive companion drops to 0 HP and transitions them into
   * the knocked-out state. Ticks the revival timer and progress while they're down.
   */
  private updateKnockoutState(): void {
    const inactive = this.inactive();

    // Companion just died → enter knocked-out state
    if (!inactive.isAlive && !inactive.isKnockedOut) {
      inactive.isKnockedOut = true;
      inactive.knockedOutFrames = 0;
      inactive.reviveProgress = 0;
      inactive.statusEffects = [];
      this.audio?.play(inactive === this.human ? 'human_knocked_out' : 'cat_knocked_out');
    }

    if (!inactive.isKnockedOut) return;

    inactive.knockedOutFrames++;

    const active = this.active();
    const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);

    if (dist <= this.REVIVE_RANGE_PX) {
      if (inactive.reviveProgress === 0) {
        this.audio?.play('reviving_tone');
      }
      inactive.reviveProgress++;
      if (inactive.reviveProgress >= this.REVIVE_FRAMES) {
        // Revival complete
        inactive.isKnockedOut = false;
        inactive.knockedOutFrames = 0;
        inactive.reviveProgress = 0;
        inactive.hp = Math.max(1, Math.ceil(inactive.maxHp * 0.01));
        this.audio?.play(inactive === this.human ? 'human_revived' : 'cat_revived');
      }
    } else {
      inactive.reviveProgress = 0;
    }
  }

  /** Renders the knocked-out warning banner, directional arrow, and revival progress bar. */
  private renderKnockedOutUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
  ): void {
    const inactive = this.inactive();
    if (!inactive.isKnockedOut) return;

    const active = this.active();
    const t = Date.now();
    const pulse = 0.75 + 0.25 * Math.sin(t * 0.006);

    // On mobile, the minimap occupies the top-right corner — keep the banner in the
    // available space to its left so the text doesn't slide behind it.
    const mmSz = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    const availW = platform.isMobile ? canvas.width - mmSz - 16 : canvas.width;
    const cx = availW / 2;
    const bannerSize = platform.isMobile ? 15 : 22;

    // "Revive your teammate!" banner
    drawText(ctx, 'Revive your teammate!', {
      x: cx,
      y: 44,
      align: 'center',
      ...TEXT_PRESETS.danger,
      size: bannerSize,
      outline: true,
      alpha: pulse,
      width: availW - 16,
    });

    // Countdown timer
    const secondsLeft = Math.max(0, Math.ceil((5400 - inactive.knockedOutFrames) / 60));
    drawText(ctx, `${secondsLeft}s`, {
      x: cx,
      y: platform.isMobile ? 62 : 70,
      align: 'center',
      ...TEXT_PRESETS.danger,
      size: 15,
      color: secondsLeft <= 10 ? '#ef4444' : '#fbbf24',
      outline: true,
      alpha: pulse,
    });

    const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);

    if (dist > this.REVIVE_RANGE_PX) {
      // Arrow above the active player pointing toward the downed companion
      const dx = inactive.x - active.x;
      const dy = inactive.y - active.y;
      const angle = Math.atan2(dy, dx);
      const bounce = Math.sin(t * 0.005) * 4;
      const len = 22;

      // Screen position: centre of active player's tile, 28px above the sprite
      const arrowX = active.x - camX + TILE_SIZE / 2;
      const arrowY = active.y - camY - 28 + bounce;

      ctx.save();
      ctx.translate(arrowX, arrowY);
      ctx.rotate(angle);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(-len * 0.45, -len * 0.5);
      ctx.lineTo(-len * 0.1, 0);
      ctx.lineTo(-len * 0.45, len * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (inactive.reviveProgress > 0) {
      const barW = 160;
      const barH = 18;
      const barX = cx - barW / 2;
      const barY = 96;

      drawProgressBar(ctx, {
        x: barX,
        y: barY,
        width: barW,
        height: barH,
        value: inactive.reviveProgress / this.REVIVE_FRAMES,
        ...PROGRESS_PRESETS.stamina,
        border: '#ffffff',
        borderWidth: 1,
        radius: 2,
      });

      drawText(ctx, 'REVIVING', {
        x: cx,
        y: barY + 3,
        align: 'center',
        size: 11,
        bold: true,
        color: '#fff',
        outline: true,
      });
    }
  }

  private renderStairwellRevealArrow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    if (!this._revealStairwell) return;
    const stairs = this.gameMap.stairwellTiles;
    if (stairs.length === 0) return;

    const player = this.active();
    const px = player.x + TILE_SIZE / 2;
    const py = player.y + TILE_SIZE / 2;

    let nearest = stairs[0];
    let nearestDist = Infinity;
    for (const s of stairs) {
      const sx = (s.x + 1) * TILE_SIZE;
      const sy = (s.y + 1) * TILE_SIZE;
      const d = Math.hypot(px - sx, py - sy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = s;
      }
    }

    const targetX = (nearest.x + 1) * TILE_SIZE;
    const targetY = (nearest.y + 1) * TILE_SIZE;
    const dx = targetX - px;
    const dy = targetY - py;
    const angle = Math.atan2(dy, dx);

    const t = Date.now();
    const bounce = Math.sin(t * 0.005) * 4;
    const len = 22;
    const arrowX = player.x - camX + TILE_SIZE / 2;
    const arrowY = player.y - camY - TILE_SIZE * 1.5 + bounce;

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.45, -len * 0.5);
    ctx.lineTo(-len * 0.1, 0);
    ctx.lineTo(-len * 0.45, len * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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
    const bounce = Math.sin(t * 0.005) * 4;
    const len = 22;
    const arrowX = player.x - camX + TILE_SIZE / 2;
    const arrowY = player.y - camY - TILE_SIZE * 1.5 + bounce;

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.fillStyle = '#a855f7';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.45, -len * 0.5);
    ctx.lineTo(-len * 0.1, 0);
    ctx.lineTo(-len * 0.45, len * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private triggerCompanionFollow(): void {
    this.followerMenu.open();
  }

  /** Snapshot a player, stripping god-mode stat boosts so they never persist across floors. */
  private _cleanSnapFor(p: Player): PlayerSnapshot {
    const snap = snapPlayer(p);
    if (this._godModeSnapshot !== null) {
      const pre = p === this.human ? this._godModeSnapshot.human : this._godModeSnapshot.cat;
      snap.strength = pre.strength;
      snap.intelligence = pre.intelligence;
      snap.constitution = pre.constitution;
      snap.maxHp = pre.maxHp;
      snap.hp = Math.min(snap.hp, pre.maxHp);
    }
    return snap;
  }

  /** Return a clean ability manager: if god mode boosted abilities, restore pre-god levels. */
  private _cleanAbilityManager(): AbilityManager {
    if (this._godModeSnapshot === null) return this.abilityManager;
    const clean = this.abilityManager.clone();
    clean.restoreStates(this._godModeSnapshot.abilityLevels);
    return clean;
  }

  private triggerOpenChat(): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    const context =
      `Human is level ${this.human.level}, Cat is level ${this.cat.level}. ` +
      `Floor: ${this.levelDef.id}. ` +
      `Human HP: ${this.human.hp}/${this.human.maxHp}, Cat HP: ${this.cat.hp}/${this.cat.maxHp}.`;
    this.playerChat.open(this.sceneManager.canvas, (text) => {
      if (text.trim() === '!god') {
        if (this._godModeSnapshot !== null) {
          const { human: hs, cat: cs, abilityLevels } = this._godModeSnapshot;
          this.human.strength = hs.strength;
          this.human.intelligence = hs.intelligence;
          this.human.constitution = hs.constitution;
          this.human.maxHp = hs.maxHp;
          this.human.hp = Math.min(this.human.hp, hs.maxHp);
          this.human.speedMultiplier = hs.speedMultiplier;
          this.cat.strength = cs.strength;
          this.cat.intelligence = cs.intelligence;
          this.cat.constitution = cs.constitution;
          this.cat.maxHp = cs.maxHp;
          this.cat.hp = Math.min(this.cat.hp, cs.maxHp);
          this.cat.speedMultiplier = cs.speedMultiplier;
          this.abilityManager.restoreStates(abilityLevels);
          this._godModeSnapshot = null;
          this.human.godMode = false;
          this.cat.godMode = false;
          this.playerChat.showBubble('⚡ GOD MODE OFF');
        } else if (this._toughModeActive) {
          for (const p of [this.human, this.cat]) {
            p.godMode = false;
            p.zeroDamage = false;
          }
          this._toughModeActive = false;
          this.playerChat.showBubble('⚡ GOD MODE ON (disabled Tough Mode first)');
          this._godModeSnapshot = {
            human: {
              strength: this.human.strength,
              intelligence: this.human.intelligence,
              constitution: this.human.constitution,
              maxHp: this.human.maxHp,
              speedMultiplier: this.human.speedMultiplier,
            },
            cat: {
              strength: this.cat.strength,
              intelligence: this.cat.intelligence,
              constitution: this.cat.constitution,
              maxHp: this.cat.maxHp,
              speedMultiplier: this.cat.speedMultiplier,
            },
            abilityLevels: this.abilityManager.snapshotStates(),
          };
          for (const p of [this.human, this.cat]) {
            p.strength += 300;
            p.intelligence += 300;
            p.constitution += 300;
            p.maxHp += 300;
            p.hp += 300;
            p.godMode = true;
            p.speedMultiplier = 2;
          }
          const godAbilityIdsOverride: AbilityId[] = ['magic_missile', 'protective_shell', 'smush'];
          for (const id of godAbilityIdsOverride) {
            this.abilityManager.setLevel(id, 15);
          }
        } else {
          this._godModeSnapshot = {
            human: {
              strength: this.human.strength,
              intelligence: this.human.intelligence,
              constitution: this.human.constitution,
              maxHp: this.human.maxHp,
              speedMultiplier: this.human.speedMultiplier,
            },
            cat: {
              strength: this.cat.strength,
              intelligence: this.cat.intelligence,
              constitution: this.cat.constitution,
              maxHp: this.cat.maxHp,
              speedMultiplier: this.cat.speedMultiplier,
            },
            abilityLevels: this.abilityManager.snapshotStates(),
          };
          for (const p of [this.human, this.cat]) {
            p.strength += 300;
            p.intelligence += 300;
            p.constitution += 300;
            p.maxHp += 300;
            p.hp += 300;
            p.godMode = true;
            p.speedMultiplier = 2;
          }
          const godAbilityIds: AbilityId[] = ['magic_missile', 'protective_shell', 'smush'];
          for (const id of godAbilityIds) {
            this.abilityManager.setLevel(id, 15);
          }
          this.playerChat.showBubble('⚡ GOD MODE ON');
        }
        return;
      }
      if (text.trim() === '!tough') {
        if (this._toughModeActive) {
          for (const p of [this.human, this.cat]) {
            p.godMode = false;
            p.zeroDamage = false;
          }
          this._toughModeActive = false;
          this.playerChat.showBubble('🛡️ TOUGH MODE OFF');
        } else {
          if (this._godModeSnapshot !== null) {
            const { human: hs, cat: cs, abilityLevels } = this._godModeSnapshot;
            this.human.strength = hs.strength;
            this.human.intelligence = hs.intelligence;
            this.human.constitution = hs.constitution;
            this.human.maxHp = hs.maxHp;
            this.human.hp = Math.min(this.human.hp, hs.maxHp);
            this.human.speedMultiplier = hs.speedMultiplier;
            this.cat.strength = cs.strength;
            this.cat.intelligence = cs.intelligence;
            this.cat.constitution = cs.constitution;
            this.cat.maxHp = cs.maxHp;
            this.cat.hp = Math.min(this.cat.hp, cs.maxHp);
            this.cat.speedMultiplier = cs.speedMultiplier;
            this.abilityManager.restoreStates(abilityLevels);
            this._godModeSnapshot = null;
          }
          for (const p of [this.human, this.cat]) {
            p.godMode = true;
            p.zeroDamage = true;
          }
          this._toughModeActive = true;
          this.playerChat.showBubble('🛡️ TOUGH MODE ON');
        }
        return;
      }
      if (text.trim() === '!reveal') {
        this._revealStairwell = !this._revealStairwell;
        this.playerChat.showBubble(
          this._revealStairwell ? '🧭 STAIRWELL REVEALED' : '🧭 STAIRWELL HIDDEN',
        );
        return;
      }
      if (text.trim() === '!spider') {
        if (this.gameMap.spiderLabRoom === null) {
          this.audio?.play('error');
        } else {
          this._revealSpiderLab = !this._revealSpiderLab;
          this.playerChat.showBubble(
            this._revealSpiderLab ? '🕷 SPIDER LAB REVEALED' : '🕷 SPIDER LAB HIDDEN',
          );
        }
        return;
      }
      this.playerChat.showBubble(text);
      void aiAdapter.chatWithSystem(text, context);
    });
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
      this.audio?.play('mongo_released');
    }
  }

  private restartAtFloorEntry(): void {
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
        audio: this.audio ?? undefined,
      }),
    );
  }

  private hasNearbyEnemy(player: HumanPlayer | CatPlayer, range: number): boolean {
    const px = player.x + TILE_SIZE * 0.5;
    const py = player.y + TILE_SIZE * 0.5;
    const nearby = this.mobGrid.queryCircle(px, py, range);
    for (const mob of nearby) {
      if (mob.isAlive) return true;
    }
    return false;
  }

  private triggerSpaceAction(tapScreenX?: number, tapScreenY?: number): void {
    // Space bar advances / dismisses achievement notifications and loot boxes
    if (this.achievementUI.handleSpaceBar()) return;

    if (this.abilityLevelUpDialog.handleSpaceBar()) return;
    if (this.levelCompleteScreen.handleSpaceBar()) return;
    if (this.gameOver && this.deathScreen.handleSpaceBar()) {
      this.restartAtFloorEntry();
      return;
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.mordecaiDialogOpen = false;
      return;
    }
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) {
      if (this.safeRoom.isNearBed(active)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(active)) {
        const humanEvents = this.humanAchievements.getTopRecentEvents(5);
        const catEvents = this.catAchievements.getTopRecentEvents(5);
        const merged = [...humanEvents, ...catEvents]
          .sort((a, b) => a.secondsAgo - b.secondsAgo)
          .slice(0, 5);
        const responsePromise = aiAdapter.chatWithMordecai({
          recentEvents: merged,
          humanLevel: this.human.level,
          catLevel: this.cat.level,
        });
        this.safeRoom.openMordecaiDialog(responsePromise);
      }
      return;
    }
    // If an enemy is within attack range, prefer attacking over interacting
    const attackRange = this.human.isActive ? TILE_SIZE * 3 : TILE_SIZE * 5;
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
      if (this.juicerRoom.tryPickupNear(active) || this.barriers.tryPickupNear(active)) {
        return;
      }
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
      if (this.pauseMenu.catMissileDefault && this.cat.triggerMissile()) {
        this.audio?.play('cat_missile_fire');
      } else {
        this.cat.triggerAttack();
      }
    }
  }

  private triggerHotbarActivation(hotbarIdx: number): void {
    const active = this.active();
    const slot = active.inventory.actionBar.slots[hotbarIdx];
    if (slot?.id === 'health_potion') {
      if (active.potionCooldownFrames > 0) {
        this.audio?.play('error_taking_action');
        return;
      }
      const hpBefore = active.hp;
      if (active.usePotion()) {
        const playerName = active === this.human ? 'Human' : 'Cat';
        this.bus.emit('healingPotionUsed', {
          player: playerName,
          hpRestored: active.hp - hpBefore,
        });
      }
    } else if (slot?.abilityId === 'magic_missile' && !this.human.isActive) {
      if (this.cat.triggerMissile()) {
        this.audio?.play('cat_missile_fire');
      }
    } else if (slot?.abilityId === 'protective_shell' && this.human.isActive) {
      const level = this.human.getProtectiveShellLevel();
      if (this.spells.triggerProtectiveShell(this.human, this.cat, this.mobGrid, level)) {
        this.abilityManager.addUsageXp('protective_shell');
        this.audio?.play('human_protective_shell');
      }
    } else if (slot?.abilityId === 'smush' && this.human.isActive) {
      if (this.human.triggerSmush()) {
        this.audio?.play('human_smush');
      }
    } else if (slot?.id === 'scroll_of_confusing_fog') {
      this.spells.castConfusingFog(active);
      this.audio?.play('confusing_fog');
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
    notifyButtonClick(mx, my);
    if (this.chestRewardDialog.isOpen) {
      this.chestRewardDialog.handleClick(mx, my);
      return;
    }
    if (this.abilityLevelUpDialog.handleClick(mx, my)) return;
    if (this.defendQuest.handleClick(mx, my)) return;
    if (this.spiderQuest.handleClick(mx, my)) return;
    if (this.achievementUI.handleClick(mx, my)) return;

    if (this.followerMenu.isOpen) {
      this.followerMenu.handleClick(mx, my);
      return;
    }

    if (!platform.isMobile && !this.gameOver && !this.pauseMenu.isOpen) {
      if (pointInRect(mx, my, this.touch.followBtnRect)) {
        this.triggerCompanionFollow();
        return;
      }
    }

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
      if (
        (this.human.unspentPoints > 0 || this.cat.unspentPoints > 0) &&
        pointInRect(mx, my, this._hudSkillBannerRect)
      ) {
        this.pauseMenu.openToSpend();
        this.audio?.play('menu_open');
        return;
      }
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.mordecaiDialogOpen = false;
      return;
    }

    if (this.levelCompleteScreen.isActive) {
      this.levelCompleteScreen.handleClick(mx, my);
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
      if (this.deathScreen.handleClick(mx, my)) {
        this.restartAtFloorEntry();
      }
      return;
    }

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }

    const canvas = this.sceneManager.canvas;
    const active = this.active();
    const invPlayer = this.inventoryPlayer();

    const gearResult = this.gearPanel.handleClick(mx, my, canvas, active.inventory);
    if (gearResult) {
      if (gearResult.unequippedItem) active.removeItemBonus(gearResult.unequippedItem);
      return;
    }

    if (this.gearPanel.isOpen && this.inventoryPanel.isOpen) {
      const slotIdx = this.inventoryPanel.getClickedInventorySlot(
        mx,
        my,
        canvas,
        invPlayer.inventory,
      );
      if (slotIdx !== null) {
        const item = invPlayer.inventory.bag.slots[slotIdx];
        if (item?.type === 'armor' && item.equipSlot && item.equipSubSlot) {
          const prev = invPlayer.inventory.equip(slotIdx);
          if (prev) invPlayer.removeItemBonus(prev);
          invPlayer.applyItemBonus(item);
          return;
        }
      }
    }

    if (this.inventoryPanel.handleClick(mx, my, canvas, invPlayer.inventory)) {
      this.resolvePendingInventoryAction(invPlayer);
      return;
    }

    const { x: camX, y: camY } = this.camera();
    if (this.loot.tryCollectLootAt(mx, my, camX, camY, active)) return;

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
    this._mouseDown = true;
    if (this.gameOver || this.pauseMenu.isOpen) return;
    if (this.miniMap.isExpanded && pointInRect(mx, my, this.touch.miniMapRect)) {
      this._miniMapDragging = true;
      this._miniMapDragLastX = mx;
      this._miniMapDragLastY = my;
      return;
    }
    this.inventoryPanel.handleMouseDown(
      mx,
      my,
      this.sceneManager.canvas,
      this.inventoryPlayer().inventory,
    );
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    if (this._miniMapDragging) {
      this.miniMap.pan(mx - this._miniMapDragLastX, my - this._miniMapDragLastY);
      this._miniMapDragLastX = mx;
      this._miniMapDragLastY = my;
    }
    this.inventoryPanel.handleMouseMove(mx, my);
    this.gearPanel.handleMouseMove(mx, my, this.sceneManager.canvas, this.active().inventory);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseDown = false;
    this._miniMapDragging = false;
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.handleMouseUp(
      mx,
      my,
      this.sceneManager.canvas,
      this.inventoryPlayer().inventory,
    );
  }

  handleMouseLeave(): void {
    this._mouseDown = false;
    this._miniMapDragging = false;
    clearButtonMouseState();
  }

  handleContextMenu(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.openContextMenu(
      mx,
      my,
      this.sceneManager.canvas,
      this.inventoryPlayer().inventory,
    );
  }

  handleWheel(deltaY: number): void {
    if (this.pauseMenu.isOpen) this.pauseMenu.handleWheel(deltaY);
  }

  update(): void {
    aiAdapter.update();
    this.playerChat.update();
    this.achievementUI.tick();
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const inSafe = this.human.isProtected || this.cat.isProtected;
      this.achievementUI.maybeAutoTrigger(inSafe);
    }
    this.abilityLevelUpDialog.update();
    this.chestRewardDialog.tick();
    if (this.chestRewardDialog.rewardSoundPending) {
      this.chestRewardDialog.rewardSoundPending = false;
      this.audio?.play('treasure_chest_reward');
    }

    // Only tick once audio is ready so the intro visual and sound start together.
    if (this.introStarted) {
      this.dungeonIntro.tick();
    }

    if (this.bossIntro.isActive) {
      this.bossIntro.tick();
      return;
    }

    // Spider quest ticks even while other systems are paused (keyboard hero must advance)
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const sqCtx = this.buildSystemContext();
      this.spiderQuest.update(sqCtx);
      this._processSpiderQuestSounds();
      if (this.spiderQuest.questCompletePending) {
        this.spiderQuest.questCompletePending = false;
        if (this.human.gainXp(2000)) {
          this.bus.emit('playerLevelUp', { player: this.human, newLevel: this.human.level });
        }
        if (this.cat.gainXp(2000)) {
          this.bus.emit('playerLevelUp', { player: this.cat, newLevel: this.cat.level });
        }
      }
    }

    if (
      this.gameOver ||
      this.abilityLevelUpDialog.isShowing ||
      this.pauseMenu.isOpen ||
      this.chestRewardDialog.isOpen ||
      this.stairwell.menuOpen ||
      this.levelCompleteScreen.isActive ||
      this.building?.menuOpen ||
      this.defendQuest.isDialogOpen ||
      this.spiderQuest.isDialogOpen ||
      this.spiderQuest.isDungeonPaused ||
      this.playerChat.isOpen
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
    setButtonAudio(this.audio);
    setButtonMouseState(this._mouseX, this._mouseY, this._mouseDown);
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
      bodyPartGore: this.bodyPartGore,
      safeRoom: this.safeRoom,
      bossRoom: this.bossRoom,
      juicerRoom: this.juicerRoom,
      stairwell: this.stairwell,
      building: this.building,
      barriers: this.barriers,
      spells: this.spells,
      dynamite: this.dynamite,
      loot: this.loot,
      treasureChests: this.treasureChests,
      miniMap: this.miniMap,
      mongoSystem: this.mongoSystem,
      speechBubblePulse: this.speechBubblePulse,
    };

    this.renderPipeline.renderWorld(ctx, rc);
    this.defendQuest.renderObjects(ctx, camX, camY, this.active(), this.human);
    this.spiderQuest.render(ctx, camX, camY, this.active());

    this.renderPipeline.renderEntities(ctx, rc);
    this.spiderQuest.renderTableForeground(ctx, camX, camY, this.active());
    this.bossRoom.renderProjectiles(ctx, camX, camY);
    for (const mob of this.mobs) {
      if (mob instanceof GrotesqueSpider) mob.renderSpitEffects(ctx, camX, camY, TILE_SIZE);
    }

    this.playerChat.renderBubble(ctx, camX, camY, this.active());

    this.renderPipeline.renderTowerBalconyOverlay(ctx, rc);

    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) =>
      UIRenderer.renderLevelUpFlash(c, cx, cy, this.pm),
    );

    this.renderPipeline.renderVisibilityFog(ctx, rc);

    UIRenderer.renderHealthVignette(ctx, canvas, this.active(), this.gameOver);

    // Render the HUD panel. On mobile the skill-points badge is NOT drawn here;
    // it is stacked below the boss UI box further down in this method.
    const hudResult = drawHUD(
      ctx,
      canvas,
      this.human,
      this.cat,
      this.notifPulse,
      this._hudCollapsed,
    );
    this._hudToggleRect = hudResult.toggleRect;
    if (!platform.isMobile) {
      this._hudSkillBannerRect = hudResult.notifRect;
    }

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.renderKnockedOutUI(ctx, canvas, camX, camY);
      this.renderStairwellRevealArrow(ctx, camX, camY);
      this.renderSpiderLabArrow(ctx, camX, camY);
    }

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

    if (platform.isMobile) {
      // On mobile, stack the boss UI directly below the HUD bar and render the
      // skill-points badge below that so nothing overlaps.
      const mobileTopY = hudResult.hudPanelBottom + 4;
      const bossBottom = this.bossRoom.renderUI(
        ctx,
        canvas,
        camX,
        camY,
        this.mobs,
        this.human,
        this.cat,
        mobileTopY,
      );
      const skillTopY = bossBottom !== null ? bossBottom + 4 : mobileTopY;
      this._hudSkillBannerRect = renderMobileSkillBadge(
        ctx,
        canvas,
        this.human,
        this.cat,
        this.notifPulse,
        skillTopY,
      );
    } else {
      this.bossRoom.renderUI(ctx, canvas, camX, camY, this.mobs, this.human, this.cat);
    }
    this.arena.render(ctx, canvas, this.active());

    this.loot.render(ctx, camX, camY, this.active());

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const active = this.active();
      const invPlayer = this.inventoryPlayer();
      const invName = invPlayer === this.human ? 'Human' : 'Cat';
      this.inventoryPanel.abilityCooldowns.set('protective_shell', {
        current: this.spells.shellCooldown,
        max: this.spells.shellCooldownMax,
      });
      this.inventoryPanel.abilityCooldowns.set('magic_missile', {
        current: this.cat.missileCooldownCurrent,
        max: Math.max(1, this.cat.missileCooldownMax),
      });
      this.inventoryPanel.abilityCooldowns.set('smush', {
        current: this.human.smushCooldown,
        max: Math.max(1, this.human.getSmushCooldownMax()),
      });
      this.inventoryPanel.render(ctx, canvas, invPlayer.inventory, invName, invPlayer.coins);
      const activeName = this.human.isActive ? 'Human' : 'Cat';
      this.gearPanel.render(ctx, canvas, active.inventory, activeName);
      this.dynamite.renderChargeBar(ctx, canvas.width, canvas.height);
      this.barriers.renderConstructUI(ctx, canvas);
      this.defendQuest.renderUI(ctx, canvas);
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
      else
        UIRenderer.renderFollowerButton(
          ctx,
          canvas,
          this.touch,
          this.companion,
          this.human.isActive,
        );
    }

    if (this.followerMenu.isOpen)
      this.followerMenu.render(
        ctx,
        canvas,
        this.companion.getMovementMode(this.human.isActive),
        this.companion.getCombatStance(this.human.isActive),
        this.human.isActive,
      );

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
        this.gameStats,
        this.abilityManager,
        this._mouseX,
        this._mouseY,
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

    if (this.levelCompleteScreen.isActive) {
      this.levelCompleteScreen.render(ctx, canvas);
    }

    if (this.building?.menuOpen) {
      this.building.renderMenu(ctx, canvas);
    }

    if (this.safeRoom.isSleeping) {
      this.safeRoom.renderSleepOverlay(ctx, canvas);
    }

    this.achievementUI.renderOverlays(ctx, canvas);

    if (this.chestRewardDialog.isOpen) {
      this.chestRewardDialog.render(ctx, canvas);
    }

    this.abilityLevelUpDialog.render(ctx, canvas);

    if (this.bossIntro.isActive) {
      this.bossIntro.render(ctx, canvas);
    }

    this.dungeonIntro.render(ctx, canvas);

    if (this.dungeonIntro.isActive && !this.introStarted) {
      const hint = platform.isMobile ? 'Tap to begin' : 'Press any key to begin';
      drawText(ctx, hint, {
        x: Math.round(canvas.width / 2),
        y: Math.round(canvas.height * 0.78),
        align: 'center',
        size: 18,
        bold: true,
        color: '#ffffff',
        outline: true,
        glow: true,
      });
    }

    aiAdapter.render(ctx, canvas);
    this.playerChat.renderChatHint(ctx, canvas);
    this.spiderQuest.renderUI(ctx, canvas, camX, camY);

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
        const targets: Player[] = [];
        if (this.mongoSystem.mongo) targets.push(this.mongoSystem.mongo);
        const npc = this.defendQuest.questNPC;
        if (npc?.isAlive) targets.push(npc);
        return targets.length > 0 ? targets : undefined;
      })(),
    };
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
    if (!this.spiderQuest.playerLocked) {
      applyMovement(player, move, this.gameMap);
    }

    if (player.isMoving) {
      this.audio?.startWalkingLoop();
    } else {
      this.audio?.stopWalkingLoop();
    }

    this.pm.updateProtection(this.safeRoom);

    const nowInSafeRoom = this.pm.isAnySafe(this.safeRoom);
    if (!this.wasInSafeRoom && nowInSafeRoom) {
      this.bus.emit('safeRoomEntered', {});
    }
    this.wasInSafeRoom = nowInSafeRoom;

    const ctx = this.buildSystemContext();

    this.safeRoom.update(ctx);
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
    if (this.defendQuest.menuClickSoundPending) {
      this.defendQuest.menuClickSoundPending = false;
      this.audio?.play('menu_click');
    }
    if (this.defendQuest.menuOpenSoundPending) {
      this.defendQuest.menuOpenSoundPending = false;
      this.audio?.play('menu_open');
    }
    this.juicerRoom.update(ctx);
    this.companion.update(ctx);
    if (this.cat.pendingAutoFireSound) {
      this.cat.pendingAutoFireSound = false;
      this.audio?.play('cat_missile_fire', { volume: 0.5 });
    }

    this.human.updateAttack();
    this.cat.updateAttack();
    this.cat.updateMissiles(this.mobs);

    this.spells.update(ctx);
    this.mobLoop.update(ctx);

    for (const mob of this.mobs) {
      if (mob.attackSoundPending) {
        mob.attackSoundPending = false;
        switch (mob.audioTag) {
          case 'goblin':
            this.audio?.playRandom(['goblin_1', 'goblin_2']);
            break;
          case 'rat':
            this.audio?.playRandom(['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3']);
            break;
          case 'llama':
            this.audio?.play('llama_fireball_explosion');
            break;
          case 'troglodyte':
            this.audio?.play('troglodyte_tongue');
            break;
          case 'tuskling':
            this.audio?.playRandom([
              'tuskling_grunt_1',
              'tuskling_grunt_2',
              'tuskling_grunt_3',
              'tuskling_grunt_4',
            ]);
            break;
          case 'skyfowl':
            this.audio?.playRandom(['skyfowl_1', 'skyfowl_2']);
            break;
          case 'mongo':
            this.audio?.play('mongo_slash');
            break;
          case 'krakaren':
            this.audio?.play('krakaren_ground_slam');
            break;
        }
      }
      if (mob.projectileSoundPending) {
        mob.projectileSoundPending = false;
        if (mob.audioTag === 'llama') {
          this.audio?.play('llama_fireball');
        }
      }
      if (mob instanceof TheHoarder) {
        if (mob.damageSoundPending) {
          mob.damageSoundPending = false;
          this.audio?.playRandom(['hoarder_damage_1', 'hoarder_damage_2', 'hoarder_damage_3']);
        }
        if (mob.vomitSoundPending) {
          mob.vomitSoundPending = false;
          this.audio?.play('hoarder_vomit');
        }
      }
      if (mob instanceof Juicer && mob.throwSoundPending) {
        mob.throwSoundPending = false;
        this.audio?.play('juicer_throw');
      }
      if (mob instanceof BallOfSwine && mob.rollSoundPending) {
        mob.rollSoundPending = false;
        this.audio?.play('ball_of_swine_rolling');
      }
      if (mob instanceof KrakarenClone && mob.yellSoundPending) {
        mob.yellSoundPending = false;
        this.audio?.play('krakaren_yell');
      }
      if (mob instanceof GrotesqueSpider) {
        if (mob.slamSoundPending) {
          mob.slamSoundPending = false;
          this.audio?.play('grotesque_spider_slam_attack', { startOffset: SLAM_AUDIO_OFFSET });
        }
        if (mob.screechSoundPending) {
          mob.screechSoundPending = false;
          this.audio?.play('grotesque_spider_screech_attack', {
            startOffset: SCREECH_AUDIO_OFFSET,
          });
        }
        if (mob.spitFireSoundPending) {
          mob.spitFireSoundPending = false;
          this.audio?.play('grotesque_spider_spit_attack');
        }
        if (mob.spitLandSoundPending) {
          mob.spitLandSoundPending = false;
          this.audio?.play('grotesque_spider_spit_landing');
        }
        const spiderDist = Math.hypot(mob.x - this.active().x, mob.y - this.active().y);
        if (mob.isAlive && mob.isMoving && spiderDist < TILE_SIZE * 12) {
          this.audio?.startSpiderWalkingLoop();
        } else {
          this.audio?.stopSpiderWalkingLoop();
        }
      }
    }

    const combatCtx: CombatContext = {
      human: this.human,
      cat: this.cat,
      mobs: this.mobs,
      mobGrid: this.mobGrid,
      gameMap: this.gameMap,
      safeRoom: this.safeRoom,
      bus: this.bus,
      abilityManager: this.abilityManager,
      spells: this.spells,
      hitLanded: false,
    };
    resolvePlayerAttacks(combatCtx);
    this.cat.flushPendingSubMissiles();

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

    if (player.isMoving || combatCtx.hitLanded) {
      this.playerIdleFrames = 0;
    } else {
      this.playerIdleFrames++;
      if (this.playerIdleFrames % 300 === 0) {
        this.bus.emit('playerIdle', {
          totalIdleMs: Math.round((this.playerIdleFrames / 60) * 1000),
        });
      }
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

    this.mongoSystem.checkHealth();
    resolveKills(combatCtx);

    const touchXp = this.spells.drainTouchXp();
    if (touchXp > 0) {
      this.abilityManager.addXp('protective_shell', touchXp);
    }

    const blockXp = this.spells.drainBlockXp();
    if (blockXp > 0) {
      this.abilityManager.addXp('protective_shell', blockXp);
    }

    const shockwave = this.spells.drainPendingShockwave();
    if (shockwave !== null) {
      this.spells.addShockwaveRipple(shockwave.x, shockwave.y, shockwave.radiusPx);
      const nearBlast = this.mobGrid.queryCircle(
        shockwave.x,
        shockwave.y,
        shockwave.radiusPx + TILE_SIZE * 2,
      );
      for (const mob of nearBlast) {
        if (!mob.isAlive) continue;
        const dx = mob.x + TILE_SIZE * 0.5 - shockwave.x;
        const dy = mob.y + TILE_SIZE * 0.5 - shockwave.y;
        if (Math.hypot(dx, dy) < shockwave.radiusPx + TILE_SIZE * 2) {
          if (!this.human.zeroDamage) mob.takeDamageFrom(4, this.human, 'shell');
          mob.applyStatus(makeElectrified());
        }
      }
    }

    const chainTargets = this.spells.drainChainLightningOrigins();
    for (const target of chainTargets) {
      const nearby = this.mobGrid.queryCircle(target.x, target.y, TILE_SIZE * 3);
      let hits = 0;
      for (const mob of nearby) {
        if (!mob.isAlive || hits >= 3) continue;
        if (!this.human.zeroDamage) mob.takeDamageFrom(2, this.human, 'shell');
        this.spells.addChainLightningBolt(
          target.x,
          target.y,
          mob.x + TILE_SIZE * 0.5,
          mob.y + TILE_SIZE * 0.5,
        );
        hits++;
      }
    }

    this.mongoSystem.update(ctx);
    this.pm.tickTimers();

    if (this.human.effectDamageSoundPending) {
      this.human.effectDamageSoundPending = false;
      this.audio?.playRandom(['human_effect_damage_1', 'human_effect_damage_2']);
    }
    if (this.cat.effectDamageSoundPending) {
      this.cat.effectDamageSoundPending = false;
      this.audio?.playRandom(['cat_effect_damage_1', 'cat_effect_damage_2', 'cat_effect_damage_3']);
    }

    this.playerTick.update(ctx);
    this.loot.update(ctx);
    this.treasureChests.update(this.mobs);
    if (this.loot.drainPickups() > 0) {
      this.audio?.playRandom(['pickup_1', 'pickup_2']);
    }
    this.speechBubblePulse++;
    this.gore.update();
    this.bodyPartGore.update();
    this.dynamite.update(ctx);

    if (this.dynamite.explosionSoundPending) {
      this.dynamite.explosionSoundPending = false;
      this.audio?.play('dynamite_explosion');
    }

    if (!this.levelDef.isSafeLevel && this.levelTimerFrames > 0) {
      this.levelTimerFrames--;
    }

    revealMinimap(player, this.miniMap);

    const wasStairwellOpen = this.stairwell.menuOpen;
    this.stairwell.detect(this.active());
    if (!wasStairwellOpen && this.stairwell.menuOpen) {
      this.bus.emit('stairwellFound', {});
    }
    this.building?.detect(this.active());

    this.updateKnockoutState();

    if (
      !this.gameOver &&
      checkDeath(this.human, this.cat, !!this.levelDef.isSafeLevel, this.levelTimerFrames)
    ) {
      this.gameOver = true;
      this.barriers.cancelConstruct();
      this.deathScreen.activate();
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
      this.audio?.play('scientist_explaining_request');
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
    if (this.spiderQuest.bossFightStartPending) {
      this.spiderQuest.bossFightStartPending = false;
      this.bossIntro.trigger('grotesque_spider', 'GROTESQUE SPIDER', '#22c55e');
    }
  }

  /** Returns the player whose inventory the panel should display/interact with. */
  private inventoryPlayer(): HumanPlayer | CatPlayer {
    return this._inventoryOverridePlayer ?? this.active();
  }

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
        if (item?.equipSlot && item.equipSubSlot) {
          active.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
          active.removeItemBonus(item);
        }
      }
      active.inventory.removeItems(id, quantity);
      this.loot.addPlayerDrop(active.x, active.y, id, quantity, active);
      this.audio?.play('menu_drop_item');
    }
  }

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
      isBossFightActive: () => this.bossRoom.anyLocked,
      isPaused: () =>
        this.gameOver ||
        this.pauseMenu.isOpen ||
        this.stairwell.menuOpen ||
        (this.building?.menuOpen ?? false) ||
        this.defendQuest.isDialogOpen ||
        this.playerChat.isOpen,
    };
  }

  private camera(): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPx = this.gameMap.structure.length * TILE_SIZE;

    const targetOverride = this.spiderQuest.cameraTargetOverride;
    const targetX = targetOverride !== null ? targetOverride.x : player.x;
    const targetY = targetOverride !== null ? targetOverride.y : player.y;

    const camX = targetX + TILE_SIZE / 2 - canvas.width / 2;
    const camY = targetY + TILE_SIZE / 2 - canvas.height / 2;

    const shakeOffset = this.spiderQuest.cameraOffset;
    return {
      x: clamp(camX, 0, mapPx - canvas.width) + shakeOffset.x,
      y: clamp(camY, 0, mapPx - canvas.height) + shakeOffset.y,
    };
  }

  handleTouchStart(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

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
        !this.pauseMenu.isOpen &&
        (this.human.unspentPoints > 0 || this.cat.unspentPoints > 0) &&
        pointInRect(x, y, this._hudSkillBannerRect)
      ) {
        this.pauseMenu.openToSpend();
        this.audio?.play('menu_open');
        continue;
      }

      if (platform.isMobile && !this.gameOver && !this.pauseMenu.isOpen) {
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

      if (platform.isMobile && this.mongoSystem.canShow && this.cat.isActive) {
        const mb = this.touch.summonBtnRect;
        if (pointInRect(x, y, mb)) {
          if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerMongoSummon();
          continue;
        }
      }

      if (platform.isMobile && this.followerMenu.isOpen) {
        this.followerMenu.handleClick(x, y);
        continue;
      }

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

      if (
        this.achievementUI.isBlocking ||
        this.stairwell.menuOpen ||
        this.gameOver ||
        this.pauseMenu.isOpen ||
        this.safeRoom.mordecaiDialogOpen ||
        this.spiderQuest.isDialogOpen
      ) {
        if (this.pauseMenu.isOpen) {
          if (this.touch.pauseScrollTouchId === null) {
            this.touch.pauseScrollTouchId = touch.identifier;
            this.touch.pauseScrollTapStart = { x, y, time: Date.now() };
            this.pauseMenu.touchScrollStart(y);
          }
        } else {
          this.handleClick(x, y);
        }
        continue;
      }

      if (this.human.isActive) {
        const dynIdx = this.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
        if (dynIdx >= 0 && this.human.inventory.actionBar.slots[dynIdx]?.id === 'goblin_dynamite') {
          this.dynamite.beginCharge(dynIdx);
          this.touch.dynamiteTouchId = touch.identifier;
          continue;
        }
      }

      if (this.inventoryPanel.isOpen) {
        if (this.inventoryPanel.hitsPanel(x, y, canvas)) {
          this.handleMouseDown(x, y);
          this.touch.inventoryDragTouchId ??= touch.identifier;
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

      if (this.touch.moveTouchId === null) {
        this.touch.moveTouchId = touch.identifier;
        this.touch.moveTarget = { x, y };
        this.touch.tapStart = { x, y, time: Date.now() };
        this.pauseMenu.touchScrollStart(y);
      }
    }
  }

  handleTouchMove(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (this.touch.longPressPos) {
        const dist = Math.hypot(x - this.touch.longPressPos.x, y - this.touch.longPressPos.y);
        if (dist > 10) this.clearInvLongPress();
      }

      this.handleMouseMove(x, y);

      if (touch.identifier === this.touch.miniMapTouchId) {
        const dx = x - this.touch.miniMapTouchLastX;
        const dy = y - this.touch.miniMapTouchLastY;
        const totalDist = Math.hypot(
          x - this.touch.miniMapTouchStartX,
          y - this.touch.miniMapTouchStartY,
        );
        if (totalDist > 5) this.touch.miniMapDragged = true;
        if (this.touch.miniMapDragged) this.miniMap.pan(dx, dy);
        this.touch.miniMapTouchLastX = x;
        this.touch.miniMapTouchLastY = y;
      }

      if (touch.identifier === this.touch.moveTouchId) {
        this.touch.moveTarget = { x, y };
        this.pauseMenu.touchScrollMove(y);
      }

      if (touch.identifier === this.touch.pauseScrollTouchId) {
        this.pauseMenu.touchScrollMove(y);
      }
    }
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    const canvas = this.sceneManager.canvas;

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
        this.pauseMenu.touchScrollEnd();
        this.touch.pauseScrollTouchId = null;
        const tapStart = this.touch.pauseScrollTapStart;
        this.touch.pauseScrollTapStart = null;
        if (tapStart !== null) {
          const elapsed = Date.now() - tapStart.time;
          const moved = Math.hypot(x - tapStart.x, y - tapStart.y);
          if (elapsed < 250 && moved < 20) {
            this.handleClick(x, y);
          }
        }
        continue;
      }

      if (touch.identifier === this.touch.dynamiteTouchId) {
        const wasCharging = this.dynamite.isCharging;
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
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
          const hi = this.inventoryPanel.getHotbarTappedIndex(x, y, canvas);
          if (
            hi >= 0 &&
            wasTap &&
            !this.pauseMenu.isOpen &&
            !this.safeRoom.isSleeping &&
            !this.gameOver
          ) {
            this.triggerHotbarActivation(hi);
          } else if (wasTap) {
            this.handleClick(x, y);
          }
        }
        this.touch.inventoryDragTouchId = null;
        continue;
      }

      if (touch.identifier === this.touch.moveTouchId) {
        if (this.touch.tapStart) {
          const elapsed = Date.now() - this.touch.tapStart.time;
          const moved = Math.hypot(x - this.touch.tapStart.x, y - this.touch.tapStart.y);
          if (elapsed < 250 && moved < 20) {
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
              this.bus.emit('dynamiteUsed', { player: 'Human' });
            } else {
              this.handleClick(x, y);
              if (!this.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
                const cam = this.camera();
                const grateHandled = this.defendQuest.tryMobileTapOnGrate(
                  x,
                  y,
                  cam.x,
                  cam.y,
                  this.human,
                );
                if (!grateHandled) {
                  this.triggerSpaceAction(x, y);
                }
              }
            }
          }
        }
        this.pauseMenu.touchScrollEnd();
        this.touch.moveTouchId = null;
        this.touch.moveTarget = null;
        this.touch.tapStart = null;
      }
    }
  }
}
