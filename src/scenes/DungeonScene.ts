import { Scene, SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import type { LevelDef } from '../levels/types';
import { spawnForLevel } from '../levels/spawner';
import { getLevelDef } from '../levels';
import { drawHUD } from '../ui/HUD';
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
import { BossRoomSystem } from '../systems/BossRoomSystem';
import { DynamiteSystem } from '../systems/DynamiteSystem';
import { SpellSystem } from '../systems/SpellSystem';
import { CompanionSystem } from '../systems/CompanionSystem';
import { LootSystem } from '../systems/LootSystem';
import { StairwellSystem } from '../systems/StairwellSystem';

export class DungeonScene extends Scene {
  private gameMap: GameMap;
  private human: HumanPlayer;
  private cat: CatPlayer;
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

  // UI
  private pauseMenu: PauseMenu;
  private deathScreen: DeathScreen;
  private inventoryPanel: InventoryPanel;
  private gearPanel: GearPanel;
  private lootBoxOpener: LootBoxOpener;
  private achievementNotif = new AchievementNotification();

  // Achievement state
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;
  private _notifActive = false;
  private _notifQueue: Array<{ def: AchievementDef; mgr: AchievementManager }> =
    [];
  private _achievIconRect = { x: 0, y: 0, w: 80, h: 28 };
  private _lootBoxIconRect = { x: -9999, y: 0, w: 0, h: 0 };

  // Misc state
  private gameOver = false;
  private notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  private readonly LEVEL_TIME_LIMIT = 216_000; // 1 hour @ 60 fps
  private safeRoomEntered = false;
  private humanRegenAccum = 0;
  private catRegenAccum = 0;
  private readonly HUMAN_REGEN_FRAMES = 10800; // 3 min
  private readonly CAT_REGEN_FRAMES = 14400; // 4 min
  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;
  private speechBubblePulse = 0;

  // Key handlers
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly levelDef: LevelDef,
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
  ) {
    super();

    this.gameMap = new GameMap(
      levelDef.mapSize,
      TILE_SIZE,
      levelDef.bossRooms?.length ?? 1,
    );
    this.levelTimerFrames = levelDef.isSafeLevel ? 0 : this.LEVEL_TIME_LIMIT;

    const { x: sx, y: sy } = this.gameMap.startTile;
    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.human.isActive = true;

    this.mobs = spawnForLevel(levelDef, this.gameMap);
    this.cat.setMap(this.gameMap);

    this.mobGrid = new SpatialGrid<Mob>(TILE_SIZE * 4);
    for (const mob of this.mobs) this.mobGrid.insert(mob);

    // Systems
    this.miniMap = new MiniMapSystem(this.gameMap);
    this.safeRoom = new SafeRoomSystem(this.gameMap, sx, sy);
    this.bossRoom = new BossRoomSystem(this.gameMap, this.miniMap);
    this.dynamite = new DynamiteSystem(this.gameMap);
    this.spells = new SpellSystem();
    this.companion = new CompanionSystem(this.gameMap, sx, sy);
    this.loot = new LootSystem(this.gameMap);
    this.stairwell = new StairwellSystem(this.gameMap, levelDef, () => {
      if (!levelDef.nextLevelId) return;
      this.sceneManager.replace(
        new DungeonScene(
          getLevelDef(levelDef.nextLevelId),
          this.input,
          this.sceneManager,
        ),
      );
    });

    // UI
    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
    this.inventoryPanel = new InventoryPanel();
    this.gearPanel = new GearPanel();
    this.lootBoxOpener = new LootBoxOpener();

    // Achievements
    this.humanAchievements = new AchievementManager();
    this.catAchievements = new AchievementManager();
  }

  // ── Scene lifecycle ─────────────────────────────────────────────────────────

  onEnter(): void {
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (this.safeRoom.mordecaiDialogOpen) {
        this.safeRoom.mordecaiDialogOpen = false;
        return;
      }
      if (this.stairwell.menuOpen) {
        this.stairwell.closeMenu();
        return;
      }
      if (!this.gameOver) {
        this.pauseMenu.toggle();
        if (!this.pauseMenu.isOpen) this.input.clear();
      }
    };

    this.actionHandler = (e: KeyboardEvent) => {
      if (this.pauseMenu.isOpen || this.safeRoom.isSleeping) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        this.safeRoom.mordecaiDialogOpen = false;
        this.human.isActive = !this.human.isActive;
        this.cat.isActive = !this.cat.isActive;
        this.cat.autoTarget = null;
        this.human.autoTarget = null;
        this.companion.isFollowOverride = false;
        return;
      }

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
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
        if (this.human.isActive) {
          this.companion.snapFacingToNearestMob(
            this.human,
            TILE_SIZE * 3,
            this.mobGrid,
          );
          this.human.triggerAttack();
        } else {
          this.companion.snapFacingToNearestMob(
            this.cat,
            TILE_SIZE * 5,
            this.mobGrid,
          );
          this.cat.triggerAttack();
        }
        return;
      }

      if ((e.key === 'q' || e.key === 'Q') && !e.repeat) {
        e.preventDefault();
        if (this.human.isActive) this.human.usePotion();
        else this.cat.usePotion();
        return;
      }

      if ((e.key === 'i' || e.key === 'I') && !e.repeat) {
        e.preventDefault();
        this.inventoryPanel.toggle();
        return;
      }

      if ((e.key === 'g' || e.key === 'G') && !e.repeat) {
        e.preventDefault();
        this.gearPanel.toggle();
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        e.preventDefault();
        this.companion.isFollowOverride = true;
        this.inactive().autoTarget = null;
        return;
      }

      if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        e.preventDefault();
        this.miniMap.toggle();
        return;
      }

      const hotbarIdx = parseInt(e.key) - 1;
      if (!e.repeat && hotbarIdx >= 0 && hotbarIdx < 8) {
        e.preventDefault();
        const active = this.active();
        const slot = active.inventory.hotbar[hotbarIdx];
        if (slot?.id === 'health_potion') {
          active.usePotion();
        } else if (slot?.abilityId === 'protective_shell') {
          this.spells.triggerProtectiveShell(this.human, this.mobGrid);
        } else if (slot?.id === 'scroll_of_confusing_fog') {
          this.spells.castConfusingFog(active);
        } else if (slot?.id === 'goblin_dynamite' && this.human.isActive) {
          this.dynamite.beginCharge(hotbarIdx);
        }
        return;
      }
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      if (this.pauseMenu.isOpen || this.safeRoom.isSleeping || this.gameOver)
        return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < 8 && this.dynamite.chargingHotbarIdx === idx) {
        this.dynamite.release(this.human, this.cat, this.mobs, this.mobGrid);
      }
    };

    window.addEventListener('keydown', this.escHandler);
    window.addEventListener('keydown', this.actionHandler);
    window.addEventListener('keyup', this.keyupHandler);
  }

  onExit(): void {
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    if (this.actionHandler)
      window.removeEventListener('keydown', this.actionHandler);
    if (this.keyupHandler)
      window.removeEventListener('keyup', this.keyupHandler);
  }

  handleClick(mx: number, my: number): void {
    if (this.lootBoxOpener.isOpen) return;

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

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const ai = this._achievIconRect;
      if (mx >= ai.x && mx <= ai.x + ai.w && my >= ai.y && my <= ai.y + ai.h) {
        const totalUnread =
          this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
        if (totalUnread > 0) {
          this._notifQueue = [
            ...this.humanAchievements.pendingNotifications.map((def) => ({
              def,
              mgr: this.humanAchievements,
            })),
            ...this.catAchievements.pendingNotifications.map((def) => ({
              def,
              mgr: this.catAchievements,
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
        if (this.humanAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('human');
        } else if (this.catAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('cat');
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

    if (this.gameOver) {
      if (this.deathScreen.handleClick(mx, my, this.sceneManager.canvas)) {
        this.sceneManager.replace(
          new DungeonScene(this.levelDef, this.input, this.sceneManager),
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

    const gearResult = this.gearPanel.handleClick(
      mx,
      my,
      canvas,
      active.inventory,
    );
    if (gearResult) {
      if (gearResult.unequippedItem)
        active.removeItemBonus(gearResult.unequippedItem);
      return;
    }

    if (this.gearPanel.isOpen && this.inventoryPanel.isOpen) {
      const slotIdx = this.inventoryPanel.getClickedInventorySlot(
        mx,
        my,
        canvas,
        active.inventory,
      );
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

  handleMouseDown(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.handleMouseDown(
      mx,
      my,
      this.sceneManager.canvas,
      this.active().inventory,
    );
  }

  handleMouseMove(mx: number, my: number): void {
    this.inventoryPanel.handleMouseMove(mx, my);
    this.gearPanel.handleMouseMove(
      mx,
      my,
      this.sceneManager.canvas,
      this.active().inventory,
    );
  }

  handleMouseUp(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.inventoryPanel.handleMouseUp(
      mx,
      my,
      this.sceneManager.canvas,
      this.active().inventory,
    );
  }

  handleContextMenu(mx: number, my: number): void {
    if (this.gameOver || this.pauseMenu.isOpen || !this.inventoryPanel.isOpen)
      return;
    this.inventoryPanel.openContextMenu(
      mx,
      my,
      this.sceneManager.canvas,
      this.active().inventory,
    );
  }

  // ── Main update / render ────────────────────────────────────────────────────

  update(): void {
    if (this.lootBoxOpener.isOpen) this.lootBoxOpener.tick();
    if (this._notifActive) this.achievementNotif.tick();

    if (this.gameOver || this.pauseMenu.isOpen || this.stairwell.menuOpen)
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

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.gameMap.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);

    this.safeRoom.renderObjects(
      ctx,
      camX,
      camY,
      this.active(),
      this.speechBubblePulse,
    );
    this.bossRoom.renderObjects(ctx, camX, camY);
    this.stairwell.renderStairwells(ctx, camX, camY, canvas);

    const visibleMobs = this.mobGrid.queryRect(
      camX - TILE_SIZE,
      camY - TILE_SIZE,
      canvas.width + TILE_SIZE * 2,
      canvas.height + TILE_SIZE * 2,
    );
    for (const mob of visibleMobs) mob.render(ctx, camX, camY, TILE_SIZE);

    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    this.spells.renderShell(ctx, camX, camY);
    this.spells.renderFogs(ctx, camX, camY);
    this.renderLevelUpFlash(ctx, camX, camY);
    this.dynamite.render(ctx, camX, camY);

    drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse);

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.miniMap.render(
        ctx,
        canvas,
        this.active(),
        this.inactive(),
        this.mobs,
        this.safeRoom.mordecaiTileX,
        this.safeRoom.mordecaiTileY,
      );
    }

    if (!this.levelDef.isSafeLevel && !this.gameOver) {
      this.renderLevelTimer(ctx, canvas);
    }

    this.bossRoom.renderUI(
      ctx,
      canvas,
      camX,
      camY,
      this.mobs,
      this.human,
      this.cat,
    );

    this.loot.render(ctx, camX, camY, this.active());

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const active = this.active();
      const name = this.human.isActive ? 'Human' : 'Cat';
      this.inventoryPanel.abilityCooldowns.set('protective_shell', {
        current: this.spells.shellCooldown,
        max: this.spells.shellCooldownMax,
      });
      this.inventoryPanel.render(
        ctx,
        canvas,
        active.inventory,
        name,
        active.coins,
      );
      this.gearPanel.render(ctx, canvas, active.inventory, name);
      this.dynamite.renderChargeBar(ctx, canvas.width, canvas.height);
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

    if (this.safeRoom.isSleeping) {
      this.safeRoom.renderSleepOverlay(ctx, canvas);
    }

    if (this._notifActive && this._notifQueue.length > 0) {
      this.achievementNotif.render(ctx, canvas, this._notifQueue[0].def);
    }
  }

  // ── Core gameplay update ────────────────────────────────────────────────────

  private updateGameplay(): void {
    const player = this.active();
    const mapPx = this.gameMap.structure.length * TILE_SIZE;

    let dx = 0;
    let dy = 0;
    if (this.input.has('ArrowUp') || this.input.has('w')) dy -= 1;
    if (this.input.has('ArrowDown') || this.input.has('s')) dy += 1;
    if (this.input.has('ArrowLeft') || this.input.has('a')) dx -= 1;
    if (this.input.has('ArrowRight') || this.input.has('d')) dx += 1;

    player.isMoving = dx !== 0 || dy !== 0;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }
    dx *= PLAYER_SPEED;
    dy *= PLAYER_SPEED;

    const nextX = Math.max(0, Math.min(mapPx - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXnext, tileYcur)) player.x = nextX;

    const nextY = Math.max(0, Math.min(mapPx - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXcur, tileYnext)) player.y = nextY;

    // Safe room flags
    this.human.isProtected = this.safeRoom.isEntityInSafeRoom(this.human);
    this.cat.isProtected = this.safeRoom.isEntityInSafeRoom(this.cat);

    if (
      !this.safeRoomEntered &&
      (this.human.isProtected || this.cat.isProtected)
    ) {
      this.safeRoomEntered = true;
      this.humanAchievements.tryUnlock('safe_haven');
      this.catAchievements.tryUnlock('safe_haven');
    }

    this.safeRoom.evictMobs(this.mobs, this.mobGrid);
    this.bossRoom.update(this.mobs, this.mobGrid, this.human, this.cat);

    this.companion.update(
      this.human,
      this.cat,
      this.mobs,
      this.mobGrid,
      player.isMoving,
    );

    this.human.updateAttack();
    this.cat.updateMissiles();

    // Spell system (resets confusion, ticks fogs/shell)
    this.spells.update(this.mobs, this.mobGrid);

    // Mob AI — only activate mobs near players
    const AI_RADIUS = TILE_SIZE * 22;
    const activeMobs = this.mobGrid.queryCircle(
      this.human.x,
      this.human.y,
      AI_RADIUS,
    );
    this.mobGrid.queryCircle(this.cat.x, this.cat.y, AI_RADIUS, activeMobs);
    const playerTargets = [this.human, this.cat];
    for (const mob of activeMobs) {
      if (!mob.isAlive) continue;
      const ox = mob.x,
        oy = mob.y;
      if (mob.isConfused) {
        mob.currentTarget = null;
        mob.doWander();
      } else {
        mob.updateAI(playerTargets);
      }
      mob.tickTimers();
      this.mobGrid.move(mob, ox, oy);
    }

    this.resolvePlayerAttacks();
    this.resolveKills();

    this.human.tickTimers();
    this.cat.tickTimers();

    // Health regeneration
    if (this.human.isAlive && this.human.hp < this.human.maxHp) {
      this.humanRegenAccum += this.human.maxHp / this.HUMAN_REGEN_FRAMES;
      const heal = Math.floor(this.humanRegenAccum);
      if (heal >= 1) {
        this.human.hp = Math.min(this.human.maxHp, this.human.hp + heal);
        this.humanRegenAccum -= heal;
      }
    } else {
      this.humanRegenAccum = 0;
    }
    if (this.cat.isAlive && this.cat.hp < this.cat.maxHp) {
      this.catRegenAccum += this.cat.maxHp / this.CAT_REGEN_FRAMES;
      const heal = Math.floor(this.catRegenAccum);
      if (heal >= 1) {
        this.cat.hp = Math.min(this.cat.maxHp, this.cat.hp + heal);
        this.catRegenAccum -= heal;
      }
    } else {
      this.catRegenAccum = 0;
    }

    this.updateCompanionPotion();

    this.loot.update(this.active(), this.inactive());

    this.speechBubblePulse++;

    this.dynamite.update(this.human, this.cat, this.mobs, this.mobGrid);

    if (!this.levelDef.isSafeLevel && this.levelTimerFrames > 0) {
      this.levelTimerFrames--;
    }

    // Mini-map fog reveal
    const ptx = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const pty = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
    this.miniMap.revealAround(ptx, pty);
    this.miniMap.tickCorpseMarkers();

    this.stairwell.detect(this.active());

    // Death check
    if (!this.human.isAlive || !this.cat.isAlive) {
      this.gameOver = true;
      this.deathScreen.activate();
    }
    if (
      !this.levelDef.isSafeLevel &&
      this.levelTimerFrames <= 0 &&
      !this.gameOver
    ) {
      this.gameOver = true;
      this.deathScreen.activate();
    }
  }

  // ── Combat resolution ────────────────────────────────────────────────────────

  private resolvePlayerAttacks(): void {
    const centerOf = (e: { x: number; y: number }) => ({
      x: e.x + TILE_SIZE * 0.5,
      y: e.y + TILE_SIZE * 0.5,
    });

    if (
      this.human.isAttackPeak() &&
      !this.safeRoom.isEntityInSafeRoom(this.human)
    ) {
      const hc = centerOf(this.human);
      const range = this.human.getMeleeRange();
      const damage = this.human.getMeleeDamage();
      const nearHuman = this.mobGrid.queryCircle(hc.x, hc.y, range);
      for (const mob of nearHuman) {
        if (!mob.isAlive) continue;
        const mc = centerOf(mob);
        const dx = mc.x - hc.x;
        const dy = mc.y - hc.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > range) continue;
        if (dist > TILE_SIZE * 0.65) {
          const dot =
            (dx / dist) * this.human.facingX + (dy / dist) * this.human.facingY;
          if (dot <= 0.3) continue;
        }
        if (!this.gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
        mob.takeDamageFrom(damage, this.human, 'melee');
      }
    }

    if (!this.safeRoom.isEntityInSafeRoom(this.cat)) {
      const hitRadius = TILE_SIZE * 0.7;
      for (const missile of this.cat.getMissiles()) {
        if (missile.state !== 'flying' || missile.hit) continue;
        const damage = this.cat.getMissileDamage();
        const nearMissile = this.mobGrid.queryCircle(
          missile.x,
          missile.y,
          hitRadius + TILE_SIZE,
        );
        for (const mob of nearMissile) {
          if (!mob.isAlive) continue;
          const mc = centerOf(mob);
          const dist = Math.hypot(missile.x - mc.x, missile.y - mc.y);
          if (dist < hitRadius) {
            mob.takeDamageFrom(damage, this.cat, 'missile');
            missile.hit = true;
            missile.state = 'exploding';
            break;
          }
        }
      }
    }
  }

  private resolveKills(): void {
    for (const mob of this.mobs) {
      if (!mob.justDied) continue;
      mob.justDied = false;
      this.mobGrid.remove(mob);
      this.miniMap.addCorpseMarker(
        mob.x + TILE_SIZE * 0.5,
        mob.y + TILE_SIZE * 0.5,
      );

      let totalDmg = 0;
      for (const dmg of mob.damageTakenBy.values()) totalDmg += dmg;
      if (totalDmg === 0) continue;

      let topPlayer: HumanPlayer | CatPlayer | null = null;
      let maxDmg = 0;
      for (const [p, dmg] of mob.damageTakenBy) {
        if (dmg > maxDmg) {
          maxDmg = dmg;
          topPlayer = p as HumanPlayer | CatPlayer;
        }
      }
      const otherPlayer = topPlayer === this.human ? this.cat : this.human;

      const totalXp = mob.xpValue;
      const topXp = Math.max(1, Math.round(totalXp * 0.85));
      const shareXp = Math.max(1, totalXp - topXp);
      if (topPlayer) topPlayer.gainXp(topXp);
      if (otherPlayer) otherPlayer.gainXp(shareXp);

      // Achievement checks
      if (mob.killedBy === this.human)
        this.humanAchievements.tryUnlock('first_blood');
      if (mob.killedBy === this.cat)
        this.catAchievements.tryUnlock('first_blood');
      if (mob.isBoss) {
        this.humanAchievements.tryUnlock('boss_slayer');
        this.catAchievements.tryUnlock('boss_slayer');
      }
      if (
        mob.killedBy === this.human &&
        mob.killType === 'melee' &&
        this.human.nextType === 'punch'
      ) {
        this.humanAchievements.tryUnlock('smush');
      }
      if (mob.killedBy === this.cat && mob.killType === 'missile') {
        this.catAchievements.tryUnlock('magic_touch');
      }

      if (mob.droppedLoot && topPlayer) {
        this.loot.addLoot(
          mob.x + TILE_SIZE * 0.5,
          mob.y + TILE_SIZE * 0.5,
          mob.droppedLoot,
          topPlayer,
        );
        mob.droppedLoot = null;
      }
    }
  }

  // ── Companion auto-potion ───────────────────────────────────────────────────

  private updateCompanionPotion(): void {
    if (this.humanAutoPotionCooldown > 0) this.humanAutoPotionCooldown--;
    if (this.catAutoPotionCooldown > 0) this.catAutoPotionCooldown--;

    if (this.human.isActive) {
      if (
        this.cat.isAlive &&
        this.cat.hp < this.cat.maxHp * 0.5 &&
        this.catAutoPotionCooldown === 0
      ) {
        if (this.cat.usePotion()) this.catAutoPotionCooldown = 180;
      }
    } else {
      if (
        this.human.isAlive &&
        this.human.hp < this.human.maxHp * 0.5 &&
        this.humanAutoPotionCooldown === 0
      ) {
        if (this.human.usePotion()) this.humanAutoPotionCooldown = 180;
      }
    }
  }

  // ── Inventory actions ───────────────────────────────────────────────────────

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

  // ── Loot box queue ──────────────────────────────────────────────────────────

  private openBoxQueue(player: 'human' | 'cat'): void {
    const mgr =
      player === 'human' ? this.humanAchievements : this.catAchievements;
    const target = player === 'human' ? this.human : this.cat;
    const boxes = [...mgr.pendingBoxes];
    if (boxes.length === 0) return;
    this.pauseMenu.close();
    this.lootBoxOpener.startQueue(
      boxes,
      (box, contents) => {
        mgr.openBox(box.id);
        target.inventory.addItem('health_potion', contents.potions);
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

  // ── Camera ──────────────────────────────────────────────────────────────────

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

  // ── Rendering helpers ───────────────────────────────────────────────────────

  private renderLevelUpFlash(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    for (const p of [this.human, this.cat] as const) {
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

  private renderLevelTimer(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const totalSec = Math.max(0, Math.ceil(this.levelTimerFrames / 60));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const display = `${min}:${sec.toString().padStart(2, '0')}`;

    const urgent = totalSec <= 60;
    const warning = totalSec <= 300;

    const mmSize = this.miniMap.isExpanded
      ? this.miniMap.EXPANDED_SIZE
      : this.miniMap.NORMAL_SIZE;
    const w = 80;
    const h = 28;
    const x = canvas.width - w - 88;
    const y = 8 + mmSize + 8;

    const urgentAlpha = urgent
      ? 0.85 + Math.sin(Date.now() / 160) * 0.12
      : 0.75;
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
    const mmSize = this.miniMap.isExpanded
      ? this.miniMap.EXPANDED_SIZE
      : this.miniMap.NORMAL_SIZE;
    return {
      x: this.sceneManager.canvas.width - 88,
      y: 8 + mmSize + 8,
      w: 80,
      h: 28,
    };
  }

  private drawPauseButton(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
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
    ctx.fillText('Pause (Esc)', pb.x + pb.w / 2, pb.y + pb.h / 2 + 4);
    ctx.textAlign = 'left';
    void canvas;
  }

  private achievementIconRect(): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const mmSize = this.miniMap.isExpanded
      ? this.miniMap.EXPANDED_SIZE
      : this.miniMap.NORMAL_SIZE;
    return {
      x: this.sceneManager.canvas.width - 88,
      y: 8 + mmSize + 8 + 28 + 6,
      w: 80,
      h: 26,
    };
  }

  private drawAchievementIcon(ctx: CanvasRenderingContext2D): void {
    if (
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.lootBoxOpener.isOpen ||
      this._notifActive
    ) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const unread =
      this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
    if (unread === 0) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

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

  private drawLootBoxIcon(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const inSafe = this.human.isProtected || this.cat.isProtected;
    const totalBoxes =
      this.humanAchievements.pendingBoxes.length +
      this.catAchievements.pendingBoxes.length;

    if (
      !inSafe ||
      totalBoxes === 0 ||
      this.gameOver ||
      this.pauseMenu.isOpen ||
      this.lootBoxOpener.isOpen ||
      this._notifActive
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
    ctx.fillText(
      totalBoxes === 1 ? '1 box' : `${totalBoxes} boxes`,
      x + w / 2,
      y + bounce + 68,
    );

    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }
}
