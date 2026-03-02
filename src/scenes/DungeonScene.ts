import { Scene, SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import {
  TILE_SIZE,
  PLAYER_SPEED,
  FOLLOWER_SPEED,
  CAT_KITE_DIST,
  CAT_BEHIND_HUMAN_OFFSET,
  HUMAN_ENGAGE_RANGE,
} from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import type { LevelDef } from '../levels/types';
import { spawnForLevel } from '../levels/spawner';
import { drawHUD } from '../ui/HUD';
import { PauseMenu } from '../ui/PauseMenu';
import { DeathScreen } from '../ui/DeathScreen';
import {
  drawMordecaiSprite,
  drawSpeechBubble,
} from '../sprites/mordecaiSprite';
import { InventoryPanel } from '../ui/InventoryPanel';
import { GearPanel } from '../ui/GearPanel';
import type { LootDrop } from '../creatures/Mob';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';

interface PendingLoot {
  x: number;
  y: number;
  loot: LootDrop;
  owner: HumanPlayer | CatPlayer;
  collected: boolean;
  /** Frames until this loot expires and disappears. */
  ttl: number;
}

export class DungeonScene extends Scene {
  private gameMap: GameMap;
  private human: HumanPlayer;
  private cat: CatPlayer;
  private mobs: Mob[];

  private pauseMenu: PauseMenu;
  private deathScreen: DeathScreen;
  private inventoryPanel: InventoryPanel;
  private gearPanel: GearPanel;
  private gameOver = false;

  /** Loot bags waiting to be collected after mob kills. */
  private pendingLoots: PendingLoot[] = [];

  /** Oscillation counter passed to HUD for the skill-point notification pulse. */
  private notifPulse = { value: 0 };

  // ── Cat idle-wander state ──────────────────────────────────────────────────
  private catWanderTargetX = 0;
  private catWanderTargetY = 0;
  private catWanderTimer = 0;
  /** Angle used by the cat's kiting orbit. Increments every frame. */
  private catKiteAngle = 0;

  // ── Human idle tracking (for cat wander gate) ─────────────────────────────
  /** Frames the human has been idle (not moving) while active as the player. */
  private humanIdleFrames = 0;

  // ── Protective Shell Spell ────────────────────────────────────────────────
  private activeShell: {
    x: number;
    y: number;
    radiusPx: number;
    framesRemaining: number;
    totalFrames: number;
  } | null = null;
  private shellCooldown = 0;
  private readonly SHELL_COOLDOWN = 7200; // 2 min @ 60 fps
  private readonly SHELL_DURATION = 1200; // 20 s  @ 60 fps

  // ── Companion auto-potion cooldowns (frames) ───────────────────────────────
  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;

  // ── Action-key listeners registered in onEnter / removed in onExit ─────────
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── Safe Room ──────────────────────────────────────────────────────────────
  private safeRoomBounds: { x: number; y: number; w: number; h: number } | null;

  // ── Boss Room ──────────────────────────────────────────────────────────────
  private bossRoomBounds: { x: number; y: number; w: number; h: number } | null;
  /** True once either player enters while the boss is alive. */
  private bossRoomLocked = false;
  /** True after the boss is killed — room stays unlocked permanently. */
  private bossDefeated = false;
  /** Counts down after boss defeat to hide the boss UI after a short delay. */
  private bossDefeatDisplayTimer = 0;
  /** Pulse timer for boss health bar animation. */
  private bossPulse = 0;

  // ── Mordecai NPC ──────────────────────────────────────────────────────────
  /** Tile coords of Mordecai's position inside the Safe Room. */
  private mordecaiTileX: number;
  private mordecaiTileY: number;
  private mordecaiDialogOpen = false;
  private speechBubblePulse = 0;

  // ── Bed ────────────────────────────────────────────────────────────────────
  /** Tile coords of the bed inside the Safe Room. */
  private bedTileX: number;
  private bedTileY: number;

  // ── Sleep ──────────────────────────────────────────────────────────────────
  private isSleeping = false;
  /** Countdown in frames (150 total: 30 fade-in, 90 black, 30 fade-out). */
  private sleepTimer = 0;
  private readonly SLEEP_TOTAL = 150;
  private readonly SLEEP_FADEIN = 30;
  private readonly SLEEP_HOLD = 90;
  private sleepHealed = false;

  constructor(
    private readonly levelDef: LevelDef,
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
  ) {
    super();
    this.gameMap = new GameMap(levelDef.mapSize, TILE_SIZE);
    const { x: sx, y: sy } = this.gameMap.startTile;

    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.catWanderTargetX = (sx + 1) * TILE_SIZE;
    this.catWanderTargetY = sy * TILE_SIZE;
    this.human.isActive = true;

    this.mobs = spawnForLevel(levelDef, this.gameMap);
    this.cat.setMap(this.gameMap);

    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
    this.inventoryPanel = new InventoryPanel();
    this.gearPanel = new GearPanel();

    // ── Safe Room setup ──────────────────────────────────────────────────────
    this.safeRoomBounds = this.gameMap.safeRoomBounds;
    // ── Boss Room setup ──────────────────────────────────────────────────────
    this.bossRoomBounds = this.gameMap.bossRoomBounds;
    const centre = this.gameMap.safeRoomCentre;
    if (centre && this.safeRoomBounds) {
      const halfW = Math.floor(this.safeRoomBounds.w / 4);
      // Mordecai stands on the left side of the safe room
      this.mordecaiTileX = centre.x - halfW;
      this.mordecaiTileY = centre.y;
      // Bed on the right side
      this.bedTileX = centre.x + halfW;
      this.bedTileY = centre.y;
    } else {
      // Fallback (shouldn't happen with a normal map)
      this.mordecaiTileX = sx;
      this.mordecaiTileY = sy;
      this.bedTileX = sx + 1;
      this.bedTileY = sy;
    }
  }

  // ── Scene lifecycle ─────────────────────────────────────────────────────────

  onEnter(): void {
    // Esc: toggle pause / close dialog (independent of pause state check)
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (this.mordecaiDialogOpen) {
        this.mordecaiDialogOpen = false;
        return;
      }
      if (!this.gameOver) {
        this.pauseMenu.toggle();
        if (!this.pauseMenu.isOpen) this.input.clear();
      }
    };

    // Game action keys — suppressed while paused or sleeping
    this.actionHandler = (e: KeyboardEvent) => {
      if (this.pauseMenu.isOpen || this.isSleeping) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        this.mordecaiDialogOpen = false;
        this.human.isActive = !this.human.isActive;
        this.cat.isActive = !this.cat.isActive;
        this.cat.autoTarget = null;
        this.human.autoTarget = null;
        return;
      }

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();

        // Close dialog first if open
        if (this.mordecaiDialogOpen) {
          this.mordecaiDialogOpen = false;
          return;
        }

        const active = this.active();

        // Inside safe room: prioritise interactions, block combat
        if (this.isEntityInSafeRoom(active)) {
          if (this.isNearBed(active)) {
            this.startSleep();
          } else if (this.isNearMordecai(active)) {
            this.mordecaiDialogOpen = true;
          }
          return;
        }

        // Outside safe room: normal attacks
        if (this.human.isActive) {
          this.snapFacingToNearestMob(this.human, TILE_SIZE * 3);
          this.human.triggerAttack();
        } else {
          this.snapFacingToNearestMob(this.cat, TILE_SIZE * 5);
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

      // Hotbar 1–8
      const hotbarIdx = parseInt(e.key) - 1;
      if (!e.repeat && hotbarIdx >= 0 && hotbarIdx < 8) {
        e.preventDefault();
        const active = this.active();
        const slot = active.inventory.hotbar[hotbarIdx];
        if (slot?.id === 'health_potion') {
          active.usePotion();
        } else if (slot?.abilityId === 'protective_shell') {
          this.triggerProtectiveShell();
        }
        return;
      }
    };

    window.addEventListener('keydown', this.escHandler);
    window.addEventListener('keydown', this.actionHandler);
  }

  onExit(): void {
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    if (this.actionHandler)
      window.removeEventListener('keydown', this.actionHandler);
  }

  handleClick(mx: number, my: number): void {
    if (this.mordecaiDialogOpen) {
      this.mordecaiDialogOpen = false;
      return;
    }

    // Death screen takes priority
    if (this.gameOver) {
      if (this.deathScreen.handleClick(mx, my, this.sceneManager.canvas)) {
        this.sceneManager.replace(
          new DungeonScene(this.levelDef, this.input, this.sceneManager),
        );
      }
      return;
    }

    // Pause menu buttons
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }

    // Inventory panel (toggle button, close, pagination)
    const canvas = this.sceneManager.canvas;
    const active = this.active();

    // Gear panel toggle / slot click (unequip)
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

    // Equip on click: click armor item in inventory while gear panel is open
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

    // Pending loot collection (click on the loot badge in world space)
    if (this.tryCollectLootAt(mx, my)) return;

    // Pause button (top-right corner)
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

  /** Check and apply any pending context-menu equip action set by InventoryPanel. */
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
  }

  // ── Main update / render ────────────────────────────────────────────────────

  update(): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;

    if (this.isSleeping) {
      this.updateSleep();
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

    // ── Safe room world-space decorations ────────────────────────────────────
    this.renderSafeRoomObjects(ctx, camX, camY);

    // ── Boss room world-space decorations ─────────────────────────────────
    this.renderBossRoomObjects(ctx, camX, camY);

    for (const mob of this.mobs) mob.render(ctx, camX, camY, TILE_SIZE);

    // Inactive companion renders behind active player
    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    this.renderShell(ctx, camX, camY);
    this.renderLevelUpFlash(ctx, camX, camY);

    drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse);

    // ── Boss health bar + room barrier ────────────────────────────────────
    this.renderBossUI(ctx, canvas, camX, camY);

    // ── Pending loot bubbles (world space) ────────────────────────────────
    this.renderPendingLoots(ctx, camX, camY);

    // ── Inventory panel + hotbar + gear panel ─────────────────────────────
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      const active = this.active();
      const name = this.human.isActive ? 'Human' : 'Cat';
      // Update ability cooldowns for hotbar display
      this.inventoryPanel.abilityCooldowns.set('protective_shell', {
        current: this.shellCooldown,
        max: this.SHELL_COOLDOWN,
      });
      this.inventoryPanel.render(
        ctx,
        canvas,
        active.inventory,
        name,
        active.coins,
      );
      this.gearPanel.render(ctx, canvas, active.inventory, name);
    }

    if (this.gameOver) {
      this.deathScreen.render(ctx, canvas);
    }

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.render(ctx, canvas, this.human, this.cat);
    }

    this.drawPauseButton(ctx, canvas);

    // ── Safe room UI overlays ─────────────────────────────────────────────
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.renderSafeRoomUI(ctx, canvas, camX, camY);
    }

    // ── Mordecai dialog ───────────────────────────────────────────────────
    if (this.mordecaiDialogOpen) {
      this.renderMordecaiDialog(ctx, canvas);
    }

    // ── Sleep overlay ─────────────────────────────────────────────────────
    if (this.isSleeping) {
      this.renderSleepOverlay(ctx, canvas);
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

    // ── Human idle tracker (gates cat wander) ─────────────────────────────
    if (this.human.isActive) {
      if (player.isMoving) this.humanIdleFrames = 0;
      else this.humanIdleFrames++;
    } else {
      this.humanIdleFrames = 0;
    }

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

    // Per-axis collision for the active player
    const nextX = Math.max(0, Math.min(mapPx - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXnext, tileYcur)) player.x = nextX;

    const nextY = Math.max(0, Math.min(mapPx - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXcur, tileYnext)) player.y = nextY;

    // ── Safe room protection flags (set each frame) ────────────────────────
    this.human.isProtected = this.isEntityInSafeRoom(this.human);
    this.cat.isProtected = this.isEntityInSafeRoom(this.cat);

    // ── Teleport mobs that wander into the safe room ───────────────────────
    this.evictMobsFromSafeRoom();

    // ── Boss Room: trigger lock, clamp players inside ─────────────────────
    this.updateBossRoom();

    // ── Follower movement ──────────────────────────────────────────────────
    if (this.human.isActive) {
      if (this.cat.autoTarget && this.cat.autoTarget.isAlive) {
        const enemy = this.cat.autoTarget as Mob;
        if (enemy.currentTarget === this.cat) {
          this.doCatKite(enemy);
        } else if (enemy.currentTarget === this.human) {
          this.doCatBehindHuman(enemy);
        } else {
          this.companionFollow(
            this.cat,
            enemy.x,
            enemy.y,
            FOLLOWER_SPEED,
            TILE_SIZE * 2.5,
          );
        }
      } else if (this.humanIdleFrames >= 300) {
        // ── Cat wander — only once human has been idle for 5 seconds ────────
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE;
          this.catWanderTargetX = this.human.x + Math.cos(angle) * radius;
          this.catWanderTargetY = this.human.y + Math.sin(angle) * radius;
          this.catWanderTimer = 160 + Math.floor(Math.random() * 240);
        }
        if (
          Math.hypot(this.cat.x - this.human.x, this.cat.y - this.human.y) >
          TILE_SIZE * 3.5
        ) {
          this.catWanderTargetX = this.human.x;
          this.catWanderTargetY = this.human.y;
        }
        this.companionFollow(
          this.cat,
          this.catWanderTargetX,
          this.catWanderTargetY,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.5,
        );
      } else {
        // ── Human recently moved — cat follows smoothly, no wander jitter ───
        // Reset wander target to human position so when wander eventually
        // activates there's no sudden jump.
        this.catWanderTargetX = this.human.x;
        this.catWanderTargetY = this.human.y;
        this.catWanderTimer = 160 + Math.floor(Math.random() * 240);
        this.companionFollow(
          this.cat,
          this.human.x,
          this.human.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.5,
        );
      }
    } else {
      if (this.human.autoTarget && this.human.autoTarget.isAlive) {
        this.companionFollow(
          this.human,
          this.human.autoTarget.x,
          this.human.autoTarget.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.9,
        );
      } else {
        this.companionFollow(
          this.human,
          this.cat.x,
          this.cat.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.8,
        );
      }
    }

    // ── Update attack / missile state ──────────────────────────────────────
    this.human.updateAttack();
    this.cat.updateMissiles();

    // ── Mob AI ────────────────────────────────────────────────────────────
    // Only run full AI for mobs within the activation radius of either player.
    // Distant mobs are frozen (no wander, no pathfinding) until the player
    // gets close. This keeps per-frame cost O(active_mobs) instead of O(all_mobs),
    // which matters a lot on large maps with many spawned enemies.
    const playerTargets = [this.human, this.cat];
    const AI_RADIUS_SQ = (TILE_SIZE * 22) ** 2;
    const hx = this.human.x,
      hy = this.human.y;
    const cx = this.cat.x,
      cy = this.cat.y;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      const dx1 = mob.x - hx,
        dy1 = mob.y - hy;
      const dx2 = mob.x - cx,
        dy2 = mob.y - cy;
      if (
        dx1 * dx1 + dy1 * dy1 <= AI_RADIUS_SQ ||
        dx2 * dx2 + dy2 * dy2 <= AI_RADIUS_SQ
      ) {
        mob.updateAI(playerTargets);
        mob.tickTimers();
      }
    }

    // ── Shell spell tick ──────────────────────────────────────────────────
    if (this.shellCooldown > 0) this.shellCooldown--;
    if (this.activeShell) {
      this.activeShell.framesRemaining--;
      this.pushMobsFromShell();
      if (this.activeShell.framesRemaining <= 0) this.activeShell = null;
    }

    this.updateAutoAI();
    this.resolvePlayerAttacks();
    this.resolveKills();
    this.spawnHoarderCockroaches();
    this.tickCockroachTTLs();

    this.human.tickTimers();
    this.cat.tickTimers();
    if (this.bossDefeatDisplayTimer > 0) this.bossDefeatDisplayTimer--;

    this.updateCompanionPotion();

    // ── Pending loot TTL + auto-collect on proximity ──────────────────────
    const activeForLoot = this.active();
    const companion = activeForLoot === this.human ? this.cat : this.human;
    for (const loot of this.pendingLoots) {
      if (loot.collected) continue;
      loot.ttl--;
      // Active player auto-collects their loot
      if (loot.owner === activeForLoot) {
        const dist = Math.hypot(
          activeForLoot.x + TILE_SIZE * 0.5 - loot.x,
          activeForLoot.y + TILE_SIZE * 0.5 - loot.y,
        );
        if (dist <= TILE_SIZE * 1.5) {
          activeForLoot.coins += loot.loot.coins;
          for (const it of loot.loot.items) {
            activeForLoot.inventory.addItem(it.id, it.quantity);
          }
          loot.collected = true;
        }
      }
      // Inactive companion auto-collects their loot when out of combat
      if (!loot.collected && loot.owner === companion) {
        const outOfCombat =
          companion.autoTarget === null || !companion.autoTarget.isAlive;
        if (outOfCombat) {
          const dist = Math.hypot(
            companion.x + TILE_SIZE * 0.5 - loot.x,
            companion.y + TILE_SIZE * 0.5 - loot.y,
          );
          if (dist <= TILE_SIZE * 1.5) {
            companion.coins += loot.loot.coins;
            for (const it of loot.loot.items) {
              companion.inventory.addItem(it.id, it.quantity);
            }
            loot.collected = true;
          }
        }
      }
    }
    this.pendingLoots = this.pendingLoots.filter(
      (l) => !l.collected && l.ttl > 0,
    );

    // ── Speech bubble pulse ───────────────────────────────────────────────
    this.speechBubblePulse++;

    // ── Death check ───────────────────────────────────────────────────────
    if (!this.human.isAlive || !this.cat.isAlive) {
      this.gameOver = true;
      this.deathScreen.activate();
    }
  }

  // ── Safe Room helpers ───────────────────────────────────────────────────────

  private isEntityInSafeRoom(entity: { x: number; y: number }): boolean {
    const b = this.safeRoomBounds;
    if (!b) return false;
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * 0.5) / ts);
    const ty = Math.floor((entity.y + ts * 0.5) / ts);
    return tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
  }

  private isNearMordecai(entity: { x: number; y: number }): boolean {
    const mx = this.mordecaiTileX * TILE_SIZE;
    const my = this.mordecaiTileY * TILE_SIZE;
    return Math.hypot(entity.x - mx, entity.y - my) < TILE_SIZE * 2.5;
  }

  private isNearBed(entity: { x: number; y: number }): boolean {
    const bx = this.bedTileX * TILE_SIZE;
    const by = this.bedTileY * TILE_SIZE;
    return Math.hypot(entity.x - bx, entity.y - by) < TILE_SIZE * 1.8;
  }

  private evictMobsFromSafeRoom(): void {
    if (!this.safeRoomBounds) return;
    const fallback =
      this.gameMap.mobSpawnPoints.length > 0
        ? this.gameMap.mobSpawnPoints
        : this.gameMap.hallwaySpawnPoints;
    if (fallback.length === 0) return;

    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      if (this.isEntityInSafeRoom(mob)) {
        const pt = fallback[Math.floor(Math.random() * fallback.length)];
        mob.x = pt.x * TILE_SIZE;
        mob.y = pt.y * TILE_SIZE;
      }
    }
  }

  // ── Boss Room mechanics ─────────────────────────────────────────────────────

  private isEntityInBossRoom(entity: { x: number; y: number }): boolean {
    if (!this.bossRoomBounds) return false;
    const b = this.bossRoomBounds;
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
    return tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
  }

  private updateBossRoom(): void {
    if (!this.bossRoomBounds || this.bossDefeated) return;
    this.bossPulse++;

    const bossAlive = this.mobs.some(
      (m) => m instanceof TheHoarder && m.isAlive,
    );

    // Trigger lock when either player enters and boss is alive
    if (
      !this.bossRoomLocked &&
      bossAlive &&
      (this.isEntityInBossRoom(this.human) || this.isEntityInBossRoom(this.cat))
    ) {
      this.bossRoomLocked = true;
    }

    // Unlock when boss is defeated
    if (this.bossRoomLocked && !bossAlive) {
      this.bossRoomLocked = false;
      this.bossDefeated = true;
      this.bossDefeatDisplayTimer = 300;
      // Kill all cockroaches
      for (const mob of this.mobs) {
        if (mob instanceof Cockroach && mob.isAlive) {
          mob.hp = 0;
          mob.justDied = true;
        }
      }
    }

    // Clamp both players inside the boss room while locked
    if (this.bossRoomLocked) {
      this.clampToBossRoom(this.human);
      this.clampToBossRoom(this.cat);
    }
  }

  private clampToBossRoom(entity: { x: number; y: number }): void {
    if (!this.bossRoomBounds) return;
    const b = this.bossRoomBounds;
    const minPx = b.x * TILE_SIZE;
    const minPy = b.y * TILE_SIZE;
    const maxPx = (b.x + b.w - 1) * TILE_SIZE;
    const maxPy = (b.y + b.h - 1) * TILE_SIZE;
    entity.x = Math.max(minPx, Math.min(maxPx, entity.x));
    entity.y = Math.max(minPy, Math.min(maxPy, entity.y));
  }

  private spawnHoarderCockroaches(): void {
    const MAX_COCKROACHES = 3;
    for (const mob of this.mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;
      if (mob.cockroachSpawns.length === 0) continue;
      const liveCount = this.mobs.filter(
        (m) => m instanceof Cockroach && m.isAlive,
      ).length;
      let spawned = liveCount;
      for (const sp of mob.cockroachSpawns) {
        if (spawned >= MAX_COCKROACHES) break;
        const tileX = Math.floor(sp.x / TILE_SIZE);
        const tileY = Math.floor(sp.y / TILE_SIZE);
        if (this.gameMap.isWalkable(tileX, tileY)) {
          const roach = new Cockroach(tileX, tileY, TILE_SIZE);
          roach.setMap(this.gameMap);
          this.mobs.push(roach);
          spawned++;
        }
      }
      mob.cockroachSpawns = [];
    }
  }

  private tickCockroachTTLs(): void {
    for (const mob of this.mobs) {
      if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
      mob.ttl--;
      if (mob.ttl <= 0) {
        mob.hp = 0;
        mob.justDied = true;
      }
    }
    // Prune dead cockroaches periodically to avoid unbounded array growth
    if (this.mobs.length > 200) {
      this.mobs = this.mobs.filter(
        (m) => m.isAlive || !(m instanceof Cockroach),
      );
    }
  }

  // ── Sleep mechanic ──────────────────────────────────────────────────────────

  private startSleep(): void {
    this.isSleeping = true;
    this.sleepTimer = this.SLEEP_TOTAL;
    this.sleepHealed = false;
  }

  private updateSleep(): void {
    this.sleepTimer--;

    // Heal at the moment the screen goes fully black
    if (
      !this.sleepHealed &&
      this.sleepTimer <= this.SLEEP_HOLD + this.SLEEP_FADEIN - 5
    ) {
      this.human.hp = this.human.maxHp;
      this.cat.hp = this.cat.maxHp;
      this.sleepHealed = true;
    }

    if (this.sleepTimer <= 0) {
      this.isSleeping = false;
    }
  }

  private renderSleepOverlay(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const t = this.sleepTimer;
    const fadeIn = this.SLEEP_FADEIN;
    const hold = this.SLEEP_HOLD;

    let alpha: number;
    if (t > hold + fadeIn) {
      // Fading in
      alpha = 1 - (t - hold - fadeIn) / fadeIn;
    } else if (t > fadeIn) {
      // Full black hold
      alpha = 1;
    } else {
      // Fading out
      alpha = t / fadeIn;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Show "Sleeping..." text only during the hold phase
    if (t > fadeIn && t <= hold + fadeIn) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Sleeping...', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('zZz', canvas.width / 2, canvas.height / 2 + 18);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  // ── Safe room rendering helpers ─────────────────────────────────────────────

  private renderSafeRoomObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    if (!this.safeRoomBounds) return;

    const ts = TILE_SIZE;

    // ── "SAFE ROOM" banner above the room ─────────────────────────────────
    // (world-space label rendered above the top wall of the safe room)
    const bannerTileY = this.safeRoomBounds.y - 1;
    const bannerTileX =
      this.safeRoomBounds.x + Math.floor(this.safeRoomBounds.w / 2);
    const bsx = bannerTileX * ts - camX;
    const bsy = bannerTileY * ts - camY;
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0e4c8';
    ctx.fillText('SAFE ROOM', bsx, bsy + ts * 0.65);
    ctx.textAlign = 'left';
    ctx.restore();

    // ── Bed ───────────────────────────────────────────────────────────────
    this.renderBed(
      ctx,
      this.bedTileX * ts - camX,
      this.bedTileY * ts - camY,
      ts,
    );

    // ── Mordecai ──────────────────────────────────────────────────────────
    const msx = this.mordecaiTileX * ts - camX;
    const msy = this.mordecaiTileY * ts - camY;
    drawMordecaiSprite(ctx, msx, msy, ts);

    // Speech bubble when active player is nearby
    const activeNear = this.isNearMordecai(this.active());
    if (activeNear && !this.mordecaiDialogOpen) {
      drawSpeechBubble(ctx, msx, msy, ts, this.speechBubblePulse);
    }
  }

  private renderBed(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    s: number,
  ): void {
    // Wooden frame
    ctx.fillStyle = '#7a4e2c';
    ctx.fillRect(sx + s * 0.05, sy + s * 0.12, s * 0.9, s * 0.8);

    // Mattress (cream)
    ctx.fillStyle = '#f0e8d8';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.18, s * 0.8, s * 0.65);

    // Pillow (white)
    ctx.fillStyle = '#fafaf8';
    ctx.fillRect(sx + s * 0.14, sy + s * 0.21, s * 0.72, s * 0.2);
    // Pillow seam
    ctx.strokeStyle = '#d8d0c0';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + s * 0.14, sy + s * 0.21, s * 0.72, s * 0.2);

    // Blanket (blue-teal)
    ctx.fillStyle = '#3a6e8a';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.41, s * 0.8, s * 0.42);

    // Blanket fold
    ctx.fillStyle = '#2e5a74';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.41, s * 0.8, s * 0.05);

    // Headboard (slightly darker wood)
    ctx.fillStyle = '#5c3820';
    ctx.fillRect(sx + s * 0.05, sy + s * 0.12, s * 0.9, s * 0.1);

    // Footboard
    ctx.fillRect(sx + s * 0.05, sy + s * 0.82, s * 0.9, s * 0.1);
  }

  // ── Boss Room rendering ─────────────────────────────────────────────────────

  private renderBossRoomObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    if (!this.bossRoomBounds) return;
    const b = this.bossRoomBounds;
    const ts = TILE_SIZE;
    const cx = (b.x + b.w * 0.5) * ts - camX;
    const cy = (b.y + b.h * 0.5) * ts - camY;

    // ── Room banner ────────────────────────────────────────────────────────
    const bannerX = (b.x + Math.floor(b.w / 2)) * ts - camX;
    const bannerY = (b.y - 1) * ts - camY;
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7c3aed';
    ctx.fillText('BOSS ROOM', bannerX, bannerY + ts * 0.65);
    ctx.textAlign = 'left';
    ctx.restore();

    // ── Trash decorations (seeded by room position) ───────────────────────
    ctx.save();

    // Use room position as a stable seed for trash placement
    const seed = b.x * 31 + b.y * 17;
    const rng = (n: number) => {
      const s = Math.sin(seed + n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };

    // Garbage bags — dark green rounded lumps
    for (let i = 0; i < 7; i++) {
      const gx = cx + (rng(i) - 0.5) * b.w * ts * 0.7;
      const gy = cy + (rng(i + 10) - 0.5) * b.h * ts * 0.7;
      const gw = ts * (0.5 + rng(i + 20) * 0.4);
      const gh = ts * (0.35 + rng(i + 30) * 0.25);
      ctx.fillStyle = rng(i + 5) > 0.5 ? '#1a3018' : '#0f1f0e';
      ctx.beginPath();
      ctx.ellipse(
        gx,
        gy,
        gw * 0.5,
        gh * 0.5,
        rng(i + 40) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Bag tie
      ctx.fillStyle = '#4a7a40';
      ctx.beginPath();
      ctx.arc(gx, gy - gh * 0.35, gw * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cardboard boxes — brown rectangles
    for (let i = 0; i < 4; i++) {
      const bx = cx + (rng(i + 50) - 0.5) * b.w * ts * 0.65;
      const by = cy + (rng(i + 60) - 0.5) * b.h * ts * 0.65;
      const bw = ts * (0.4 + rng(i + 70) * 0.35);
      const bh = ts * (0.3 + rng(i + 80) * 0.25);
      ctx.fillStyle = '#4a3010';
      ctx.fillRect(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      ctx.strokeStyle = '#2a1a06';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      // Box cross seam
      ctx.beginPath();
      ctx.moveTo(bx, by - bh * 0.5);
      ctx.lineTo(bx, by + bh * 0.5);
      ctx.moveTo(bx - bw * 0.5, by);
      ctx.lineTo(bx + bw * 0.5, by);
      ctx.stroke();
    }

    // Crushed cans — small silver ovals
    for (let i = 0; i < 8; i++) {
      const canX = cx + (rng(i + 90) - 0.5) * b.w * ts * 0.75;
      const canY = cy + (rng(i + 100) - 0.5) * b.h * ts * 0.75;
      ctx.fillStyle = '#8a8888';
      ctx.beginPath();
      ctx.ellipse(
        canX,
        canY,
        ts * 0.1,
        ts * 0.06,
        rng(i + 110) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Puke stains — yellowish-green blobs
    for (let i = 0; i < 5; i++) {
      const px = cx + (rng(i + 120) - 0.5) * b.w * ts * 0.6;
      const py = cy + (rng(i + 130) - 0.5) * b.h * ts * 0.6;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#8fbc14';
      ctx.beginPath();
      ctx.ellipse(
        px,
        py,
        ts * (0.28 + rng(i + 140) * 0.2),
        ts * (0.14 + rng(i + 150) * 0.1),
        rng(i + 160) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Paper scraps — tiny off-white rects
    for (let i = 0; i < 10; i++) {
      const px = cx + (rng(i + 170) - 0.5) * b.w * ts * 0.8;
      const py = cy + (rng(i + 180) - 0.5) * b.h * ts * 0.8;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rng(i + 190) * Math.PI);
      ctx.fillStyle = rng(i + 200) > 0.5 ? '#c8c0a8' : '#d8d0b8';
      ctx.fillRect(-ts * 0.12, -ts * 0.07, ts * 0.24, ts * 0.14);
      ctx.restore();
    }

    ctx.restore();
  }

  private renderBossUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
  ): void {
    if (!this.bossRoomBounds) return;

    // ── Locked-room barrier lines at room entrance walls ──────────────────
    if (this.bossRoomLocked) {
      const b = this.bossRoomBounds;
      const ts = TILE_SIZE;
      ctx.save();
      const pulse = 0.55 + 0.25 * Math.sin(this.bossPulse * 0.12);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      // Top wall
      ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
      // Warning X marks at corners
      ctx.lineWidth = 2;
      for (const [ex, ey] of [
        [b.x, b.y],
        [b.x + b.w - 1, b.y],
        [b.x, b.y + b.h - 1],
        [b.x + b.w - 1, b.y + b.h - 1],
      ] as [number, number][]) {
        const sx = ex * ts - camX;
        const sy = ey * ts - camY;
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy + 4);
        ctx.lineTo(sx + ts - 4, sy + ts - 4);
        ctx.moveTo(sx + ts - 4, sy + 4);
        ctx.lineTo(sx + 4, sy + ts - 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── Boss health bar at top-center ─────────────────────────────────────
    const boss = this.mobs.find((m) => m instanceof TheHoarder) as
      | TheHoarder
      | undefined;
    if (!boss) return;

    // Show bar if player is in or near boss room, or boss was encountered
    const playerNearBoss =
      this.isEntityInBossRoom(this.human) ||
      this.isEntityInBossRoom(this.cat) ||
      this.bossRoomLocked ||
      this.bossDefeatDisplayTimer > 0;
    if (!playerNearBoss && !this.bossRoomLocked) return;

    const barW = Math.min(360, canvas.width * 0.5);
    const barH = 18;
    const barX = Math.floor((canvas.width - barW) / 2);
    const barY = 48;
    const hpFrac = Math.max(0, boss.hp / boss.maxHp);

    ctx.save();

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(barX - 6, barY - 22, barW + 12, barH + 30);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 6, barY - 22, barW + 12, barH + 30);

    // Boss name
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = boss.isEnraged ? '#ef4444' : '#c084fc';
    ctx.textAlign = 'center';
    ctx.fillText(
      boss.isEnraged ? '⚠ THE HOARDER [ENRAGED] ⚠' : 'THE HOARDER',
      canvas.width / 2,
      barY - 6,
    );
    ctx.textAlign = 'left';

    // HP bar track
    ctx.fillStyle = '#1a0a1e';
    ctx.fillRect(barX, barY, barW, barH);

    // HP bar fill
    const barColor = boss.isEnraged ? '#ef4444' : '#7c3aed';
    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barW * hpFrac, barH);

    // Enrage threshold marker at 50%
    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX + barW * 0.5, barY);
    ctx.lineTo(barX + barW * 0.5, barY + barH);
    ctx.stroke();

    // HP bar border
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // HP text
    ctx.font = '9px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${boss.hp} / ${boss.maxHp}`,
      canvas.width / 2,
      barY + barH - 4,
    );
    ctx.textAlign = 'left';

    if (this.bossDefeated) {
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'center';
      ctx.fillText('DEFEATED', canvas.width / 2, barY + barH + 16);
      ctx.textAlign = 'left';
    }

    ctx.restore();

    // Suppress unused param warning — camX/camY used by caller
    void camX;
    void camY;
  }

  private renderSafeRoomUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
  ): void {
    const active = this.active();

    // ── Sleep prompt near the bed ─────────────────────────────────────────
    if (
      this.isEntityInSafeRoom(active) &&
      this.isNearBed(active) &&
      !this.isSleeping
    ) {
      const bsx = this.bedTileX * TILE_SIZE - camX;
      const bsy = this.bedTileY * TILE_SIZE - camY;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      const tw = 210;
      const th = 28;
      ctx.fillRect(bsx + TILE_SIZE * 0.5 - tw / 2, bsy - 38, tw, th);
      ctx.fillStyle = '#f0e8d0';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        '[Space] Sleep (restores HP)',
        bsx + TILE_SIZE * 0.5,
        bsy - 18,
      );
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // ── Talk prompt near Mordecai ─────────────────────────────────────────
    if (
      this.isEntityInSafeRoom(active) &&
      this.isNearMordecai(active) &&
      !this.mordecaiDialogOpen
    ) {
      const msx = this.mordecaiTileX * TILE_SIZE - camX;
      const msy = this.mordecaiTileY * TILE_SIZE - camY;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      const tw = 110;
      const th = 24;
      ctx.fillRect(msx + TILE_SIZE * 0.5 - tw / 2, msy - 34, tw, th);
      ctx.fillStyle = '#f0e8d0';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('[Space] Talk', msx + TILE_SIZE * 0.5, msy - 17);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // ── "SAFE ROOM" HUD label when player is inside ───────────────────────
    if (this.isEntityInSafeRoom(active)) {
      ctx.save();
      ctx.fillStyle = 'rgba(240,228,200,0.85)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('~ Safe Room ~', canvas.width / 2, canvas.height - 18);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  private renderMordecaiDialog(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const dh = 120;
    const dw = Math.min(560, canvas.width - 40);
    const dx = (canvas.width - dw) / 2;
    const dy = canvas.height - dh - 20;

    // Background
    ctx.save();
    ctx.fillStyle = 'rgba(10,8,6,0.92)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#c8a860';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    // Name plate
    ctx.fillStyle = '#c8a860';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('Mordecai', dx + 14, dy + 20);

    // Dialog text (word-wrapped manually)
    ctx.fillStyle = '#e8dfc8';
    ctx.font = '12px monospace';
    const lines = [
      'Welcome to the dungeon. Here you must kill enemies to',
      'level up and you must find the stairwell on each level',
      'to get to the next level.',
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, dx + 14, dy + 44 + i * 18);
    });

    // Dismiss hint
    ctx.fillStyle = '#7a6e5a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('[Space / Esc] Close', dx + dw - 12, dy + dh - 10);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ── Cat positioning helpers ─────────────────────────────────────────────────

  private doCatKite(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const cx = this.cat.x + TILE_SIZE * 0.5;
    const cy = this.cat.y + TILE_SIZE * 0.5;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);

    this.catKiteAngle += 0.022;

    if (distToEnemy < CAT_KITE_DIST * 0.75) {
      if (distToEnemy > 0) {
        const nx = (cx - ex) / distToEnemy;
        const ny = (cy - ey) / distToEnemy;
        const cos = Math.cos(0.4),
          sin = Math.sin(0.4);
        const sx2 = nx * cos - ny * sin;
        const sy2 = nx * sin + ny * cos;
        this.entityMoveWithCollision(
          this.cat,
          sx2 * FOLLOWER_SPEED * 1.35,
          sy2 * FOLLOWER_SPEED * 1.35,
        );
        this.cat.isMoving = true;
      }
    } else {
      const targetX =
        ex + Math.cos(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      const targetY =
        ey + Math.sin(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      this.companionFollow(
        this.cat,
        targetX,
        targetY,
        FOLLOWER_SPEED,
        TILE_SIZE * 0.5,
      );
    }
  }

  private doCatBehindHuman(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const hx = this.human.x + TILE_SIZE * 0.5;
    const hy = this.human.y + TILE_SIZE * 0.5;

    const dx = hx - ex;
    const dy = hy - ey;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const targetX = hx + nx * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    const targetY = hy + ny * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    this.companionFollow(
      this.cat,
      targetX,
      targetY,
      FOLLOWER_SPEED,
      TILE_SIZE * 0.5,
    );
  }

  // ── Companion AI ────────────────────────────────────────────────────────────

  private updateAutoAI() {
    if (this.human.isActive) {
      if (this.cat.autoTarget && !this.cat.autoTarget.isAlive)
        this.cat.autoTarget = null;

      const mobTargetingCat =
        this.mobs.find((m) => m.isAlive && m.currentTarget === this.cat) ??
        null;
      const mobTargetingHuman =
        this.mobs.find((m) => m.isAlive && m.currentTarget === this.human) ??
        null;

      if (mobTargetingCat) {
        this.cat.autoTarget = mobTargetingCat;
      } else if (!this.cat.autoTarget && mobTargetingHuman) {
        this.cat.autoTarget = mobTargetingHuman;
      }

      if (this.cat.autoTarget) {
        const tc = this.cat.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          this.cat.x + TILE_SIZE * 0.5,
          this.cat.y + TILE_SIZE * 0.5,
          tc.x + TILE_SIZE * 0.5,
          tc.y + TILE_SIZE * 0.5,
        );
        if (hasLOS) this.cat.autoFireTick();
      }
    } else {
      if (this.human.autoTarget && !this.human.autoTarget.isAlive)
        this.human.autoTarget = null;

      if (!this.human.autoTarget) {
        let closestDist = HUMAN_ENGAGE_RANGE;
        let closest: Mob | null = null;
        for (const mob of this.mobs) {
          if (!mob.isAlive) continue;
          const dist = Math.hypot(mob.x - this.human.x, mob.y - this.human.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = mob;
          }
        }
        this.human.autoTarget = closest;
      }

      if (this.human.autoTarget) {
        const th = this.human.autoTarget;
        const hasLOS = this.gameMap.hasLineOfSight(
          this.human.x + TILE_SIZE * 0.5,
          this.human.y + TILE_SIZE * 0.5,
          th.x + TILE_SIZE * 0.5,
          th.y + TILE_SIZE * 0.5,
        );
        if (hasLOS) this.human.autoFightTick();
      }
    }
  }

  private snapFacingToNearestMob(
    player: HumanPlayer | CatPlayer,
    range: number,
  ) {
    const px = player.x + TILE_SIZE * 0.5;
    const py = player.y + TILE_SIZE * 0.5;
    let bestDist = range;
    let bestMob: Mob | null = null;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      const dx = mob.x + TILE_SIZE * 0.5 - px;
      const dy = mob.y + TILE_SIZE * 0.5 - py;
      const dist = Math.hypot(dx, dy);
      if (dist > range) continue;
      const dot = (dx / dist) * player.facingX + (dy / dist) * player.facingY;
      if (dot < 0.25) continue;
      if (
        !this.gameMap.hasLineOfSight(
          px,
          py,
          mob.x + TILE_SIZE * 0.5,
          mob.y + TILE_SIZE * 0.5,
        )
      )
        continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestMob = mob;
      }
    }
    if (bestMob) {
      const dx = bestMob.x + TILE_SIZE * 0.5 - px;
      const dy = bestMob.y + TILE_SIZE * 0.5 - py;
      const d = Math.hypot(dx, dy);
      player.facingX = dx / d;
      player.facingY = dy / d;
    }
  }

  // ── Combat resolution ───────────────────────────────────────────────────────

  private resolvePlayerAttacks() {
    const centerOf = (e: { x: number; y: number }) => ({
      x: e.x + TILE_SIZE * 0.5,
      y: e.y + TILE_SIZE * 0.5,
    });

    // Human melee — fires once at the peak frame
    if (this.human.isAttackPeak() && !this.isEntityInSafeRoom(this.human)) {
      const hc = centerOf(this.human);
      const range = this.human.getMeleeRange();
      const damage = this.human.getMeleeDamage();
      for (const mob of this.mobs) {
        if (!mob.isAlive) continue;
        const mc = centerOf(mob);
        const dx = mc.x - hc.x;
        const dy = mc.y - hc.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > range) continue;
        // Skip the facing check when sprites are basically on top of each other
        if (dist > TILE_SIZE * 0.65) {
          const dot =
            (dx / dist) * this.human.facingX + (dy / dist) * this.human.facingY;
          if (dot <= 0.3) continue;
        }
        if (!this.gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
        mob.takeDamageFrom(damage, this.human);
      }
    }

    // Cat missiles
    if (!this.isEntityInSafeRoom(this.cat)) {
      for (const missile of this.cat.getMissiles()) {
        if (missile.state !== 'flying' || missile.hit) continue;
        const damage = this.cat.getMissileDamage();
        for (const mob of this.mobs) {
          if (!mob.isAlive) continue;
          const mc = centerOf(mob);
          const dist = Math.hypot(missile.x - mc.x, missile.y - mc.y);
          if (dist < TILE_SIZE * 0.7) {
            mob.takeDamageFrom(damage, this.cat);
            missile.hit = true;
            missile.state = 'exploding';
            break;
          }
        }
      }
    }
  }

  private resolveKills() {
    for (const mob of this.mobs) {
      if (!mob.justDied) continue;
      mob.justDied = false;

      let totalDmg = 0;
      for (const dmg of mob.damageTakenBy.values()) totalDmg += dmg;
      if (totalDmg === 0) continue;

      // Award XP to contributors
      for (const [player, dmg] of mob.damageTakenBy) {
        const share = Math.max(1, Math.round((dmg / totalDmg) * mob.xpValue));
        player.gainXp(share);
      }

      // Attribute loot to the top damage dealer
      if (mob.droppedLoot) {
        let creditPlayer: HumanPlayer | CatPlayer | null = null;
        let maxDmg = 0;
        for (const [player, dmg] of mob.damageTakenBy) {
          if (dmg > maxDmg) {
            maxDmg = dmg;
            creditPlayer = player as HumanPlayer | CatPlayer;
          }
        }
        if (creditPlayer) {
          this.pendingLoots.push({
            x: mob.x + TILE_SIZE * 0.5,
            y: mob.y + TILE_SIZE * 0.5,
            loot: mob.droppedLoot,
            owner: creditPlayer,
            collected: false,
            ttl: 600,
          });
        }
        mob.droppedLoot = null;
      }
    }
  }

  // ── Companion auto-potion ───────────────────────────────────────────────────

  private updateCompanionPotion() {
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

  // ── Movement / collision helpers ────────────────────────────────────────────

  private entityMoveWithCollision(
    entity: { x: number; y: number },
    dx: number,
    dy: number,
  ) {
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const ts = TILE_SIZE;
    if (dx !== 0) {
      const nextX = Math.max(0, Math.min(mapPx - ts, entity.x + dx));
      const tileXnext = Math.floor((nextX + ts / 2) / ts);
      const tileYcur = Math.floor((entity.y + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXnext, tileYcur)) entity.x = nextX;
    }
    if (dy !== 0) {
      const nextY = Math.max(0, Math.min(mapPx - ts, entity.y + dy));
      const tileXcur = Math.floor((entity.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
    }
  }

  private companionFollow(
    entity: {
      x: number;
      y: number;
      isMoving: boolean;
      facingX: number;
      facingY: number;
    },
    targetX: number,
    targetY: number,
    speed: number,
    minDist: number,
  ) {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      entity.isMoving = false;
      return;
    }
    const step = Math.min(speed, dist - minDist);
    const nx = dx / dist;
    const ny = dy / dist;
    this.entityMoveWithCollision(entity, nx * step, ny * step);
    entity.isMoving = true;
    entity.facingX = nx;
    entity.facingY = ny;
  }

  // ── Camera ──────────────────────────────────────────────────────────────────

  private camera() {
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
  ) {
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

  private pauseButtonRect() {
    return {
      x: this.sceneManager.canvas.width - 84,
      y: 8,
      w: 76,
      h: 28,
    };
  }

  private drawPauseButton(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ) {
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
  }

  // ── Loot helpers ────────────────────────────────────────────────────────────

  private renderPendingLoots(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const active = this.active();
    for (const loot of this.pendingLoots) {
      const sx = loot.x - camX;
      const sy = loot.y - camY;

      // Determine label text
      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0)
        parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');

      // Fade out as TTL drops below 120 frames
      const alpha = Math.min(1, loot.ttl / 120);
      ctx.save();
      ctx.globalAlpha = alpha;

      // Badge background
      const bw = Math.max(54, label.length * 7 + 16);
      const bh = 20;
      const bx = sx - bw / 2;
      const by = sy - 26;
      ctx.fillStyle =
        loot.owner === active ? 'rgba(15,23,42,0.85)' : 'rgba(15,23,42,0.45)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = loot.owner === active ? '#fbbf24' : '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);

      // Coin icon (small filled circle)
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(bx + 10, by + bh / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      ctx.fillStyle = loot.owner === active ? '#fde68a' : '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 18, by + bh / 2 + 4);

      // "Click to loot" hint when active player is the owner and nearby
      if (loot.owner === active) {
        const dist = Math.hypot(
          active.x + TILE_SIZE * 0.5 - loot.x,
          active.y + TILE_SIZE * 0.5 - loot.y,
        );
        if (dist <= TILE_SIZE * 3) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('[click]', sx, by - 3);
        }
      }

      ctx.restore();
    }
  }

  /**
   * Check if the click position lands on a pending loot badge that the active
   * player owns and is close enough to collect. Returns true if loot was collected.
   */
  private tryCollectLootAt(mx: number, my: number): boolean {
    const { x: camX, y: camY } = this.camera();
    const active = this.active();
    for (const loot of this.pendingLoots) {
      if (loot.owner !== active) continue;
      const dist = Math.hypot(
        active.x + TILE_SIZE * 0.5 - loot.x,
        active.y + TILE_SIZE * 0.5 - loot.y,
      );
      if (dist > TILE_SIZE * 3) continue;

      const sx = loot.x - camX;
      const sy = loot.y - camY;
      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0)
        parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');
      const bw = Math.max(54, label.length * 7 + 16);
      const bh = 20;
      const bx = sx - bw / 2;
      const by = sy - 26;

      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        active.coins += loot.loot.coins;
        for (const it of loot.loot.items) {
          active.inventory.addItem(it.id, it.quantity);
        }
        loot.collected = true;
        return true;
      }
    }
    return false;
  }

  // ── Protective Shell Spell ──────────────────────────────────────────────────

  private triggerProtectiveShell(): void {
    if (this.shellCooldown > 0) return;
    const radiusTiles = 3 + this.human.intelligence * 0.5;
    const radiusPx = radiusTiles * TILE_SIZE;
    this.activeShell = {
      x: this.human.x + TILE_SIZE * 0.5,
      y: this.human.y + TILE_SIZE * 0.5,
      radiusPx,
      framesRemaining: this.SHELL_DURATION,
      totalFrames: this.SHELL_DURATION,
    };
    this.shellCooldown = this.SHELL_COOLDOWN;
    // Immediately push any mobs that are already inside
    this.pushMobsFromShell();
  }

  private pushMobsFromShell(): void {
    if (!this.activeShell) return;
    const { x, y, radiusPx } = this.activeShell;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      const mcx = mob.x + TILE_SIZE * 0.5;
      const mcy = mob.y + TILE_SIZE * 0.5;
      const dx = mcx - x;
      const dy = mcy - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radiusPx) {
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const push = radiusPx - dist + 2;
        mob.x += nx * push;
        mob.y += ny * push;
        mob.takeDamageFrom(1, this.human);
      }
    }
  }

  private renderShell(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    if (!this.activeShell) return;
    const { x, y, radiusPx, framesRemaining, totalFrames } = this.activeShell;
    const sx = x - camX;
    const sy = y - camY;

    // Fade in during first 30 frames, fade out during last 60 frames
    const lifeFrac = framesRemaining / totalFrames;
    const fadeIn = Math.min(1, (totalFrames - framesRemaining) / 30);
    const fadeOut = Math.min(1, framesRemaining / 60);
    const alpha = Math.min(fadeIn, fadeOut);

    ctx.save();

    // Soft outer glow rings
    for (let i = 4; i >= 1; i--) {
      ctx.globalAlpha = alpha * (0.06 * i);
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = i * 3;
      ctx.beginPath();
      ctx.arc(sx, sy, radiusPx + i * 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Main shell ring — pulse brightness with remaining time
    const pulse = 0.7 + 0.3 * Math.sin(framesRemaining * 0.12);
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // Inner fill — very subtle blue tint
    ctx.globalAlpha = alpha * 0.06;
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    // Remaining duration label
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const secs = Math.ceil(framesRemaining / 60);
    ctx.fillText(`${secs}s`, sx, sy - radiusPx - 6);
    ctx.textAlign = 'left';

    ctx.restore();

    // Cooldown HUD label (above active player when shell just ended)
    void lifeFrac; // suppress unused warning
  }

  // ── Convenience accessors ───────────────────────────────────────────────────

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }
}
