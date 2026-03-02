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
import { getLevelDef } from '../levels';
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
import type { ItemId } from '../core/Inventory';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import {
  drawDynamiteFloorSprite,
  drawDynamiteExplosion,
  drawDynamiteChargeBar,
} from '../sprites/dynamiteSprite';
import { SpatialGrid } from '../core/SpatialGrid';

interface PendingLoot {
  x: number;
  y: number;
  loot: LootDrop;
  owner: HumanPlayer | CatPlayer;
  collected: boolean;
  /** Frames until this loot expires and disappears. */
  ttl: number;
  /** Frames remaining before this loot can be auto-collected (prevents instant re-pickup after drop). */
  pickupDelay: number;
  /** True for items the player manually dropped — either player can pick them up. */
  droppedByPlayer?: boolean;
}

interface BossRoomState {
  bounds: { x: number; y: number; w: number; h: number };
  locked: boolean;
  defeated: boolean;
  defeatTimer: number;
  pulse: number;
}

interface ActiveFog {
  owner: HumanPlayer | CatPlayer;
  /** Fixed world-pixel centre where the fog was cast (does not follow owner). */
  x: number;
  y: number;
  framesLeft: number;
  totalFrames: number;
  radiusPx: number;
}

interface FloorItem {
  /** Pixel position (top-left of the tile). */
  x: number;
  y: number;
  id: ItemId;
  quantity: number;
}

interface LiveDynamite {
  /** Pixel-space center position. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseFrames: number;
  state: 'flying' | 'sliding' | 'stopped' | 'exploding';
  explodeTimer: number;
}

// ── Goblin Dynamite constants ─────────────────────────────────────────────────
const DYN_MAX_CHARGE = 120; // 2 s at 60 fps → full throw
const DYN_DANGER = 240; // 4 s → charge bar turns red
const DYN_EXPLODE_HAND = 300; // 5 s → boom in hand
const DYN_FUSE = 300; // 5 s fuse after thrown/dropped
const DYN_TAP = 8; // frames: release faster than this = tap (drop at feet)
const DYN_SPEED_MIN = 2.0;
const DYN_SPEED_MAX = 21.0;
const DYN_BOUNCE = 0.6; // velocity fraction kept after wall bounce
const DYN_FRICTION = 0.88; // per-frame speed multiplier
const DYN_STOP = 0.08; // px/frame below which dynamite is considered stopped
const DYN_RADIUS = TILE_SIZE * 3; // AoE explosion radius (96 px)
const DYN_DAMAGE = 8; // damage dealt to all entities in radius
const DYN_ANIM_FRAMES = 45; // explosion animation duration

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

  /** Spatial hash grid for fast mob proximity queries (AI, combat, rendering). */
  private mobGrid!: SpatialGrid<Mob>;

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

  // ── Follow override — set by "F" key; clears when companion arrives ────────
  private companionFollowOverride = false;

  // ── Companion A* path cache — keyed by entity reference ─────────────────
  private companionPaths = new Map<
    object,
    {
      path: Array<{ x: number; y: number }>;
      timer: number;
      targetTX: number;
      targetTY: number;
    }
  >();

  // ── Action-key listeners registered in onEnter / removed in onExit ─────────
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── Goblin Dynamite ────────────────────────────────────────────────────────
  private liveDynamites: LiveDynamite[] = [];
  private dynamiteCharging: { hotbarIdx: number; chargeFrames: number } | null =
    null;

  // ── Level timer ────────────────────────────────────────────────────────────
  /** Frames remaining before the level timer expires. Counts from LEVEL_TIME_LIMIT → 0. */
  private levelTimerFrames = 0;
  private readonly LEVEL_TIME_LIMIT = 216_000; // 1 hour at 60 fps

  // ── Stairwell ──────────────────────────────────────────────────────────────
  /** True when the active player is standing on a stairwell tile. */
  private onStairwell = false;
  /** True when the descent menu is showing. */
  private stairwellMenuOpen = false;
  /** Set to true when the player dismisses the menu so it doesn't immediately reopen. */
  private stairwellDismissed = false;

  // ── Safe Room ──────────────────────────────────────────────────────────────
  private safeRoomBounds: { x: number; y: number; w: number; h: number } | null;

  // ── Boss Rooms ─────────────────────────────────────────────────────────────
  /** One state entry per boss room generated by GameMap. */
  private bossRoomStates: BossRoomState[] = [];

  // ── Confusing Fog ──────────────────────────────────────────────────────────
  /** Active fog clouds; each follows its owner and confuses mobs inside. */
  private activeFogs: ActiveFog[] = [];

  // ── Floor Items ────────────────────────────────────────────────────────────
  /** Items dropped by players that sit on the floor until picked up. */
  private floorItems: FloorItem[] = [];

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

  // ── Mini-map ────────────────────────────────────────────────────────────────
  /** Bit array: fogOfWar[ty * mapSize + tx] === 1 means that tile is revealed. */
  private fogOfWar: Uint8Array;
  private miniMapExpanded = false;
  private readonly MM_REVEAL_RADIUS = 10; // tiles revealed around active player
  private readonly MM_NORMAL_SIZE = 160; // px
  private readonly MM_EXPANDED_SIZE = 240; // px
  /** Corpse markers shown on mini-map for 30 s after a mob dies. */
  private corpseMarkers: Array<{ x: number; y: number; ttl: number }> = [];

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
    const mapSz = this.gameMap.structure.length;
    this.fogOfWar = new Uint8Array(mapSz * mapSz); // all zeros = hidden
    this.levelTimerFrames = levelDef.isSafeLevel ? 0 : this.LEVEL_TIME_LIMIT;
    const { x: sx, y: sy } = this.gameMap.startTile;

    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.catWanderTargetX = (sx + 1) * TILE_SIZE;
    this.catWanderTargetY = sy * TILE_SIZE;
    this.human.isActive = true;

    this.mobs = spawnForLevel(levelDef, this.gameMap);
    this.cat.setMap(this.gameMap);

    // Build the spatial grid — cell size = 4 tiles, a good fit for the 22-tile AI radius.
    this.mobGrid = new SpatialGrid<Mob>(TILE_SIZE * 4);
    for (const mob of this.mobs) this.mobGrid.insert(mob);

    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
    this.inventoryPanel = new InventoryPanel();
    this.gearPanel = new GearPanel();

    // ── Safe Room setup ──────────────────────────────────────────────────────
    this.safeRoomBounds = this.gameMap.safeRoomBounds;
    // ── Boss Room setup ──────────────────────────────────────────────────────
    this.bossRoomStates = this.gameMap.bossRooms.map((br) => ({
      bounds: br.bounds,
      locked: false,
      defeated: false,
      defeatTimer: 0,
      pulse: 0,
    }));
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
      if (this.stairwellMenuOpen) {
        this.stairwellMenuOpen = false;
        this.stairwellDismissed = true;
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
        this.companionFollowOverride = false;
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

      if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        e.preventDefault();
        this.companionFollowOverride = true;
        this.inactive().autoTarget = null;
        return;
      }

      if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        e.preventDefault();
        this.miniMapExpanded = !this.miniMapExpanded;
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
        } else if (slot?.id === 'scroll_of_confusing_fog') {
          this.castConfusingFog();
        } else if (slot?.id === 'goblin_dynamite' && this.human.isActive) {
          // Begin charge — release (keyup) will throw or drop
          this.dynamiteCharging = { hotbarIdx, chargeFrames: 0 };
        }
        return;
      }
    };

    // Dynamite throw — fires on key release
    this.keyupHandler = (e: KeyboardEvent) => {
      if (this.pauseMenu.isOpen || this.isSleeping || this.gameOver) return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < 8 && this.dynamiteCharging?.hotbarIdx === idx) {
        this.releaseDynamite();
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
    if (this.mordecaiDialogOpen) {
      this.mordecaiDialogOpen = false;
      return;
    }

    // Stairwell menu
    if (this.stairwellMenuOpen) {
      const canvas = this.sceneManager.canvas;
      const rects = this.stairwellMenuRects(canvas);
      if (
        mx >= rects.descend.x &&
        mx <= rects.descend.x + rects.descend.w &&
        my >= rects.descend.y &&
        my <= rects.descend.y + rects.descend.h
      ) {
        this.descend();
      } else if (
        mx >= rects.stay.x &&
        mx <= rects.stay.x + rects.stay.w &&
        my >= rects.stay.y &&
        my <= rects.stay.y + rects.stay.h
      ) {
        this.stairwellMenuOpen = false;
        this.stairwellDismissed = true;
      }
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

    if (this.inventoryPanel.pendingDropItem !== null) {
      const { id, quantity } = this.inventoryPanel.pendingDropItem;
      this.inventoryPanel.pendingDropItem = null;
      // Unequip the item if it is currently equipped, and remove stat bonuses
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
      // Spawn the dropped item at a nearby walkable tile outside pickup radius
      const dropPos = this.findDropPosition(active.x, active.y);
      this.pendingLoots.push({
        x: dropPos.x,
        y: dropPos.y,
        loot: { coins: 0, items: [{ id, quantity }] },
        owner: active,
        collected: false,
        ttl: 600,
        pickupDelay: 0,
        droppedByPlayer: true,
      });
    }
  }

  /** Find the center of a nearby walkable tile that is outside the pickup radius (> 1.5 tiles away). */
  private findDropPosition(
    dropperX: number,
    dropperY: number,
  ): { x: number; y: number } {
    const ts = TILE_SIZE;
    const cx = Math.floor((dropperX + ts * 0.5) / ts);
    const cy = Math.floor((dropperY + ts * 0.5) / ts);
    // Chebyshev radii 2–4 all guarantee Euclidean distance > 1.5 tiles from player center
    for (let r = 2; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) < r && Math.abs(dy) < r) continue; // only outer ring
          if (this.gameMap.isWalkable(cx + dx, cy + dy)) {
            return {
              x: (cx + dx) * ts + ts * 0.5,
              y: (cy + dy) * ts + ts * 0.5,
            };
          }
        }
      }
    }
    // Fallback: drop at player center (shouldn't happen in a normal room)
    return { x: dropperX + ts * 0.5, y: dropperY + ts * 0.5 };
  }

  // ── Main update / render ────────────────────────────────────────────────────

  update(): void {
    if (this.gameOver || this.pauseMenu.isOpen || this.stairwellMenuOpen)
      return;

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

    // ── Stairwells (world space) ───────────────────────────────────────────
    this.renderStairwells(ctx, camX, camY, canvas);

    // Only render mobs that are actually on screen (viewport culling).
    // With a large map and many mobs, this avoids drawing hundreds of off-screen sprites.
    const visibleMobs = this.mobGrid.queryRect(
      camX - TILE_SIZE,
      camY - TILE_SIZE,
      canvas.width + TILE_SIZE * 2,
      canvas.height + TILE_SIZE * 2,
    );
    for (const mob of visibleMobs) mob.render(ctx, camX, camY, TILE_SIZE);

    // Inactive companion renders behind active player
    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    this.renderShell(ctx, camX, camY);
    this.renderFogs(ctx, camX, camY);
    this.renderLevelUpFlash(ctx, camX, camY);

    // ── Live dynamites (world space) ──────────────────────────────────────
    for (const dyn of this.liveDynamites) {
      const sx = dyn.x - camX;
      const sy = dyn.y - camY;
      if (dyn.state !== 'exploding') {
        drawDynamiteFloorSprite(
          ctx,
          sx - TILE_SIZE * 0.5,
          sy - TILE_SIZE * 0.5,
          TILE_SIZE,
          dyn.fuseFrames,
          DYN_FUSE,
        );
      } else {
        drawDynamiteExplosion(
          ctx,
          sx,
          sy,
          TILE_SIZE,
          dyn.explodeTimer,
          DYN_ANIM_FRAMES,
          DYN_RADIUS,
        );
      }
    }

    drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse);

    // ── Mini-map (top-right) ──────────────────────────────────────────────
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.renderMiniMap(ctx, canvas);
    }

    // ── Level timer HUD ───────────────────────────────────────────────────
    if (!this.levelDef.isSafeLevel && !this.gameOver) {
      this.renderLevelTimer(ctx, canvas);
    }

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

      // ── Throw charge bar (right side, above hotbar) ───────────────────
      if (this.dynamiteCharging) {
        const ratio = Math.min(
          1,
          this.dynamiteCharging.chargeFrames / DYN_MAX_CHARGE,
        );
        drawDynamiteChargeBar(
          ctx,
          canvas.width,
          canvas.height,
          ratio,
          this.dynamiteCharging.chargeFrames,
          DYN_DANGER,
        );
      }
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

    // ── Stairwell descent menu ─────────────────────────────────────────────
    if (this.stairwellMenuOpen) {
      this.renderStairwellMenu(ctx, canvas);
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
    if (this.companionFollowOverride) {
      const caster = this.active();
      const companion = this.inactive();
      const dist = Math.hypot(companion.x - caster.x, companion.y - caster.y);
      if (dist <= TILE_SIZE) {
        this.companionFollowOverride = false;
      } else {
        this.companionFollow(
          companion,
          caster.x,
          caster.y,
          FOLLOWER_SPEED * 1.5,
          TILE_SIZE * 0.9,
        );
      }
    } else if (this.human.isActive) {
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

    // ── Confusing Fog tick ────────────────────────────────────────────────
    // Reset confusion each frame, then re-mark any mob inside an active fog.
    for (const mob of this.mobs) mob.isConfused = false;
    for (let fi = this.activeFogs.length - 1; fi >= 0; fi--) {
      const fog = this.activeFogs[fi];
      fog.framesLeft--;
      if (fog.framesLeft <= 0) {
        this.activeFogs.splice(fi, 1);
        continue;
      }
      const inFog = this.mobGrid.queryCircle(
        fog.x,
        fog.y,
        fog.radiusPx + TILE_SIZE,
      );
      for (const mob of inFog) {
        if (!mob.isAlive) continue;
        if (
          Math.hypot(
            mob.x + TILE_SIZE * 0.5 - fog.x,
            mob.y + TILE_SIZE * 0.5 - fog.y,
          ) <= fog.radiusPx
        ) {
          mob.isConfused = true;
        }
      }
    }

    // ── Mob AI ────────────────────────────────────────────────────────────
    // Query the spatial grid for mobs within the activation radius of either
    // player.  Mobs outside this radius stay frozen — no wander, no pathfinding.
    // This keeps per-frame cost O(active_mobs) rather than O(all_mobs), which
    // is critical on the large map where most mobs are far from the players.
    const playerTargets = [this.human, this.cat];
    const AI_RADIUS = TILE_SIZE * 22;
    const hx = this.human.x,
      hy = this.human.y;
    const cx = this.cat.x,
      cy = this.cat.y;
    // Union of mobs near human and cat (Set deduplicates overlap).
    const activeMobs = this.mobGrid.queryCircle(hx, hy, AI_RADIUS);
    this.mobGrid.queryCircle(cx, cy, AI_RADIUS, activeMobs);
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
      // Keep the grid in sync after the mob may have moved.
      this.mobGrid.move(mob, ox, oy);
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
    for (const state of this.bossRoomStates) {
      if (state.defeatTimer > 0) state.defeatTimer--;
      if (state.locked || state.defeatTimer > 0) state.pulse++;
    }

    this.updateCompanionPotion();

    // ── Pending loot TTL + auto-collect on proximity ──────────────────────
    const activeForLoot = this.active();
    const companion = activeForLoot === this.human ? this.cat : this.human;
    for (const loot of this.pendingLoots) {
      if (loot.collected) continue;
      loot.ttl--;
      if (loot.pickupDelay > 0) {
        loot.pickupDelay--;
        continue;
      }

      // Player-dropped items: either player can pick up immediately on contact
      if (loot.droppedByPlayer) {
        for (const player of [activeForLoot, companion] as (
          | HumanPlayer
          | CatPlayer
        )[]) {
          if (loot.collected) break;
          const dist = Math.hypot(
            player.x + TILE_SIZE * 0.5 - loot.x,
            player.y + TILE_SIZE * 0.5 - loot.y,
          );
          if (dist <= TILE_SIZE * 1.5) {
            player.coins += loot.loot.coins;
            for (const it of loot.loot.items) {
              player.inventory.addItem(it.id, it.quantity);
            }
            loot.collected = true;
          }
        }
        continue;
      }

      // Mob-dropped loot: attributed owner auto-collects on proximity
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

    // ── Goblin Dynamite ───────────────────────────────────────────────────
    if (this.dynamiteCharging) {
      this.dynamiteCharging.chargeFrames++;
      if (this.dynamiteCharging.chargeFrames >= DYN_EXPLODE_HAND) {
        this.explodeDynamiteInHand();
      }
    }
    this.updateLiveDynamites();

    // ── Level timer ───────────────────────────────────────────────────────
    if (!this.levelDef.isSafeLevel && this.levelTimerFrames > 0) {
      this.levelTimerFrames--;
    }

    // ── Mini-map: reveal fog around active player ─────────────────────────
    {
      const p = player;
      const ptx = Math.floor((p.x + TILE_SIZE * 0.5) / TILE_SIZE);
      const pty = Math.floor((p.y + TILE_SIZE * 0.5) / TILE_SIZE);
      this.revealFogAround(ptx, pty);
    }

    // ── Corpse markers: tick down TTL ─────────────────────────────────────
    for (let i = this.corpseMarkers.length - 1; i >= 0; i--) {
      if (--this.corpseMarkers[i].ttl <= 0) this.corpseMarkers.splice(i, 1);
    }

    // ── Stairwell detection ───────────────────────────────────────────────
    {
      const wasOnStairwell = this.onStairwell;
      this.onStairwell =
        Boolean(this.levelDef.nextLevelId) &&
        this.isEntityOnStairwell(this.active());
      if (!this.onStairwell) {
        // Player left the stairwell — allow menu to reopen next time they step on it
        this.stairwellDismissed = false;
        this.stairwellMenuOpen = false;
      } else if (!wasOnStairwell && !this.stairwellDismissed) {
        // First frame stepping onto stairwell
        this.stairwellMenuOpen = true;
      }
    }

    // ── Death check ───────────────────────────────────────────────────────
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

  // ── Goblin Dynamite helpers ─────────────────────────────────────────────────

  /** Called on keyup after the player has been charging a dynamite throw. */
  private releaseDynamite(): void {
    if (!this.dynamiteCharging) return;
    const { chargeFrames } = this.dynamiteCharging;
    this.dynamiteCharging = null;

    if (!this.human.inventory.removeOne('goblin_dynamite')) return;

    const isTap = chargeFrames < DYN_TAP;
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const speed = isTap
      ? 0
      : DYN_SPEED_MIN + (DYN_SPEED_MAX - DYN_SPEED_MIN) * chargeRatio;

    this.liveDynamites.push({
      x: this.human.x + TILE_SIZE * 0.5,
      y: this.human.y + TILE_SIZE * 0.5,
      vx: this.human.facingX * speed,
      vy: this.human.facingY * speed,
      fuseFrames: DYN_FUSE,
      state: isTap ? 'stopped' : 'flying',
      explodeTimer: 0,
    });
  }

  /** AoE damage to all entities within DYN_RADIUS of the given pixel center. */
  private triggerDynamiteExplosion(cx: number, cy: number): void {
    const ts = TILE_SIZE;
    const nearBlast = this.mobGrid.queryCircle(cx, cy, DYN_RADIUS + ts);
    for (const mob of nearBlast) {
      if (!mob.isAlive) continue;
      if (
        Math.hypot(mob.x + ts * 0.5 - cx, mob.y + ts * 0.5 - cy) <= DYN_RADIUS
      ) {
        mob.takeDamageFrom(DYN_DAMAGE, this.human);
      }
    }
    if (
      Math.hypot(this.human.x + ts * 0.5 - cx, this.human.y + ts * 0.5 - cy) <=
      DYN_RADIUS
    ) {
      this.human.takeDamage(DYN_DAMAGE);
    }
    if (
      Math.hypot(this.cat.x + ts * 0.5 - cx, this.cat.y + ts * 0.5 - cy) <=
      DYN_RADIUS
    ) {
      this.cat.takeDamage(DYN_DAMAGE);
    }
  }

  /** Dynamite held too long — explodes in the Human's hand. */
  private explodeDynamiteInHand(): void {
    this.dynamiteCharging = null;
    const cx = this.human.x + TILE_SIZE * 0.5;
    const cy = this.human.y + TILE_SIZE * 0.5;
    this.triggerDynamiteExplosion(cx, cy);
    // Spawn an explosion animation at the human's position
    this.liveDynamites.push({
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      fuseFrames: 0,
      state: 'exploding',
      explodeTimer: DYN_ANIM_FRAMES,
    });
  }

  /** Update all live dynamite physics + fuses; must be called each gameplay frame. */
  private updateLiveDynamites(): void {
    for (const dyn of this.liveDynamites) {
      if (dyn.state === 'exploding') {
        dyn.explodeTimer--;
        continue;
      }

      dyn.fuseFrames--;
      if (dyn.fuseFrames <= 0) {
        dyn.state = 'exploding';
        dyn.explodeTimer = DYN_ANIM_FRAMES;
        this.triggerDynamiteExplosion(dyn.x, dyn.y);
        continue;
      }

      if (dyn.state === 'flying' || dyn.state === 'sliding') {
        // X-axis movement with wall bounce
        const nextX = dyn.x + dyn.vx;
        const txX = Math.floor(nextX / TILE_SIZE);
        const ty = Math.floor(dyn.y / TILE_SIZE);
        if (!this.gameMap.isWalkable(txX, ty)) {
          dyn.vx = -dyn.vx * DYN_BOUNCE;
        } else {
          dyn.x = nextX;
        }

        // Y-axis movement with wall bounce
        const nextY = dyn.y + dyn.vy;
        const tx = Math.floor(dyn.x / TILE_SIZE);
        const tyY = Math.floor(nextY / TILE_SIZE);
        if (!this.gameMap.isWalkable(tx, tyY)) {
          dyn.vy = -dyn.vy * DYN_BOUNCE;
        } else {
          dyn.y = nextY;
        }

        // Friction / slide-to-stop
        dyn.vx *= DYN_FRICTION;
        dyn.vy *= DYN_FRICTION;
        const spd = Math.hypot(dyn.vx, dyn.vy);
        if (spd < DYN_STOP) {
          dyn.state = 'stopped';
          dyn.vx = 0;
          dyn.vy = 0;
        } else if (spd < 1.5) {
          dyn.state = 'sliding';
        }
      }
    }

    this.liveDynamites = this.liveDynamites.filter(
      (d) => !(d.state === 'exploding' && d.explodeTimer <= 0),
    );
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

    const b = this.safeRoomBounds;
    const ts = TILE_SIZE;
    // Query a slightly expanded rect (1 tile margin) to catch mobs whose
    // centre is inside the room even if their top-left is just outside.
    const candidates = this.mobGrid.queryRect(
      b.x * ts - ts,
      b.y * ts - ts,
      b.w * ts + ts * 2,
      b.h * ts + ts * 2,
    );
    for (const mob of candidates) {
      if (!mob.isAlive) continue;
      if (this.isEntityInSafeRoom(mob)) {
        const ox = mob.x,
          oy = mob.y;
        const pt = fallback[Math.floor(Math.random() * fallback.length)];
        mob.x = pt.x * ts;
        mob.y = pt.y * ts;
        this.mobGrid.move(mob, ox, oy);
      }
    }
  }

  // ── Boss Room mechanics ─────────────────────────────────────────────────────

  private isEntityInRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
    return (
      tx >= bounds.x &&
      tx < bounds.x + bounds.w &&
      ty >= bounds.y &&
      ty < bounds.y + bounds.h
    );
  }

  private updateBossRoom(): void {
    for (const state of this.bossRoomStates) {
      if (state.defeated) continue;

      // Find the boss mob whose spawn is inside this room
      const boss = this.mobs.find(
        (m) => m.isBoss && this.isEntityInRoom(m, state.bounds),
      );
      const bossAlive = boss !== undefined && boss.isAlive;

      // Trigger lock when either player enters and boss is alive
      if (
        !state.locked &&
        bossAlive &&
        (this.isEntityInRoom(this.human, state.bounds) ||
          this.isEntityInRoom(this.cat, state.bounds))
      ) {
        state.locked = true;
      }

      // Unlock when boss is defeated
      if (state.locked && !bossAlive) {
        state.locked = false;
        state.defeated = true;
        state.defeatTimer = 300;
        // Clear fog of war for the boss room neighbourhood
        this.revealBossNeighborhood(state.bounds);
        // Kill all cockroaches spawned by this boss
        for (const mob of this.mobs) {
          if (mob instanceof Cockroach && mob.isAlive) {
            mob.hp = 0;
            mob.justDied = true;
          }
        }
      }

      // Clamp both players inside while locked
      if (state.locked) {
        this.clampToBossRoom(this.human, state.bounds);
        this.clampToBossRoom(this.cat, state.bounds);
      }
    }
  }

  private clampToBossRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): void {
    const minPx = bounds.x * TILE_SIZE;
    const minPy = bounds.y * TILE_SIZE;
    const maxPx = (bounds.x + bounds.w - 1) * TILE_SIZE;
    const maxPy = (bounds.y + bounds.h - 1) * TILE_SIZE;
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
          this.mobGrid.insert(roach);
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
    // Prune dead cockroaches periodically to avoid unbounded array growth.
    // Remove them from the spatial grid first so it stays consistent.
    if (this.mobs.length > 200) {
      for (const m of this.mobs) {
        if (!m.isAlive && m instanceof Cockroach) this.mobGrid.remove(m);
      }
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
    for (const state of this.bossRoomStates) {
      this.renderSingleBossRoomObjects(ctx, camX, camY, state.bounds);
    }
  }

  private renderSingleBossRoomObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    b: { x: number; y: number; w: number; h: number },
  ): void {
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
    if (this.bossRoomStates.length === 0) return;

    // ── Locked-room barrier lines for every locked boss room ──────────────
    for (const state of this.bossRoomStates) {
      if (!state.locked) continue;
      const b = state.bounds;
      const ts = TILE_SIZE;
      ctx.save();
      const pulse = 0.55 + 0.25 * Math.sin(state.pulse * 0.12);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
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

    // ── Boss health bar — show for whichever boss room the active player is in ──
    const active = this.active();
    const relevantState = this.bossRoomStates.find(
      (s) =>
        s.locked ||
        s.defeatTimer > 0 ||
        this.isEntityInRoom(active, s.bounds) ||
        this.isEntityInRoom(this.human, s.bounds) ||
        this.isEntityInRoom(this.cat, s.bounds),
    );
    if (!relevantState) return;

    const boss = this.mobs.find(
      (m) => m.isBoss && this.isEntityInRoom(m, relevantState.bounds),
    ) as TheHoarder | undefined;
    if (!boss) return;

    const barW = Math.min(360, canvas.width * 0.5);
    const barH = 18;
    const barX = Math.floor((canvas.width - barW) / 2);
    const barY = 48;
    const hpFrac = Math.max(0, boss.hp / boss.maxHp);

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(barX - 6, barY - 22, barW + 12, barH + 30);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 6, barY - 22, barW + 12, barH + 30);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = boss.isEnraged ? '#ef4444' : '#c084fc';
    ctx.textAlign = 'center';
    ctx.fillText(
      boss.isEnraged ? '⚠ THE HOARDER [ENRAGED] ⚠' : 'THE HOARDER',
      canvas.width / 2,
      barY - 6,
    );
    ctx.textAlign = 'left';

    ctx.fillStyle = '#1a0a1e';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = boss.isEnraged ? '#ef4444' : '#7c3aed';
    ctx.fillRect(barX, barY, barW * hpFrac, barH);

    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX + barW * 0.5, barY);
    ctx.lineTo(barX + barW * 0.5, barY + barH);
    ctx.stroke();

    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = '9px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${boss.hp} / ${boss.maxHp}`,
      canvas.width / 2,
      barY + barH - 4,
    );
    ctx.textAlign = 'left';

    if (relevantState.defeated) {
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'center';
      ctx.fillText('DEFEATED', canvas.width / 2, barY + barH + 16);
      ctx.textAlign = 'left';
    }

    ctx.restore();
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
        const nearHuman = this.mobGrid.queryCircle(
          this.human.x,
          this.human.y,
          HUMAN_ENGAGE_RANGE,
        );
        for (const mob of nearHuman) {
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
    const nearPlayer = this.mobGrid.queryCircle(px, py, range);
    for (const mob of nearPlayer) {
      if (!mob.isAlive) continue;
      const dx = mob.x + TILE_SIZE * 0.5 - px;
      const dy = mob.y + TILE_SIZE * 0.5 - py;
      const dist = Math.hypot(dx, dy);
      if (dist > range || dist === 0) continue;
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
      const nearHuman = this.mobGrid.queryCircle(hc.x, hc.y, range);
      for (const mob of nearHuman) {
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
      this.mobGrid.remove(mob); // evict from spatial grid immediately
      // Leave a corpse marker on the mini-map for 30 s (1 800 frames)
      this.corpseMarkers.push({
        x: mob.x + TILE_SIZE * 0.5,
        y: mob.y + TILE_SIZE * 0.5,
        ttl: 1800,
      });

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
            pickupDelay: 0,
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
      this.companionPaths.delete(entity);
      return;
    }

    const step = Math.min(speed, dist - minDist);
    const ts = TILE_SIZE;

    // Use direct movement when close or LOS is clear
    const hasLOS =
      dist < ts * 2.5 ||
      this.gameMap.hasLineOfSight(
        entity.x + ts * 0.5,
        entity.y + ts * 0.5,
        targetX + ts * 0.5,
        targetY + ts * 0.5,
      );

    let moveNx = dx / dist;
    let moveNy = dy / dist;

    if (!hasLOS) {
      const goalTX = Math.floor((targetX + ts * 0.5) / ts);
      const goalTY = Math.floor((targetY + ts * 0.5) / ts);

      let cached = this.companionPaths.get(entity);
      if (!cached) {
        cached = { path: [], timer: 0, targetTX: -1, targetTY: -1 };
        this.companionPaths.set(entity, cached);
      }

      cached.timer--;
      if (
        cached.timer <= 0 ||
        cached.targetTX !== goalTX ||
        cached.targetTY !== goalTY
      ) {
        const startTX = Math.floor((entity.x + ts * 0.5) / ts);
        const startTY = Math.floor((entity.y + ts * 0.5) / ts);
        const raw = this.gameMap.findPath(startTX, startTY, goalTX, goalTY);
        // Skip first tile (we're already on it)
        cached.path = raw.length > 1 ? raw.slice(1) : [];
        cached.timer = 30;
        cached.targetTX = goalTX;
        cached.targetTY = goalTY;
      }

      if (cached.path.length > 0) {
        const next = cached.path[0];
        const wpX = next.x * ts;
        const wpY = next.y * ts;
        const wpDx = wpX - entity.x;
        const wpDy = wpY - entity.y;
        const wpDist = Math.hypot(wpDx, wpDy);

        // Advance to next waypoint when close enough
        if (wpDist < ts * 0.65 && cached.path.length > 1) {
          cached.path.shift();
          const next2 = cached.path[0];
          const wpDx2 = next2.x * ts - entity.x;
          const wpDy2 = next2.y * ts - entity.y;
          const wpDist2 = Math.hypot(wpDx2, wpDy2);
          if (wpDist2 > 0) {
            moveNx = wpDx2 / wpDist2;
            moveNy = wpDy2 / wpDist2;
          }
        } else if (wpDist > 0) {
          moveNx = wpDx / wpDist;
          moveNy = wpDy / wpDist;
        }
      }
    } else {
      // LOS available — clear stale path
      const cached = this.companionPaths.get(entity);
      if (cached) cached.path = [];
    }

    this.entityMoveWithCollision(entity, moveNx * step, moveNy * step);
    entity.isMoving = true;
    entity.facingX = moveNx;
    entity.facingY = moveNy;
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
    const mmSize = this.miniMapExpanded
      ? this.MM_EXPANDED_SIZE
      : this.MM_NORMAL_SIZE;
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
    // Add TILE_SIZE margin to catch mobs whose centre (x + 0.5 tile) is inside the radius.
    const nearShell = this.mobGrid.queryCircle(x, y, radiusPx + TILE_SIZE);
    for (const mob of nearShell) {
      if (!mob.isAlive) continue;
      const mcx = mob.x + TILE_SIZE * 0.5;
      const mcy = mob.y + TILE_SIZE * 0.5;
      const dx = mcx - x;
      const dy = mcy - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radiusPx) {
        const ox = mob.x,
          oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const push = radiusPx - dist + 2;
        mob.x += nx * push;
        mob.y += ny * push;
        mob.takeDamageFrom(1, this.human);
        this.mobGrid.move(mob, ox, oy);
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

  // ── Confusing Fog Spell ─────────────────────────────────────────────────────

  private castConfusingFog(): void {
    const caster = this.active();
    if (!caster.inventory.removeOne('scroll_of_confusing_fog')) return;
    const radiusPx = (3 + caster.intelligence * 0.5) * TILE_SIZE;
    const totalFrames = caster.intelligence * 5 * 60;
    this.activeFogs.push({
      owner: caster,
      x: caster.x + TILE_SIZE * 0.5,
      y: caster.y + TILE_SIZE * 0.5,
      framesLeft: totalFrames,
      totalFrames,
      radiusPx,
    });
  }

  private renderFogs(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    // Fixed cloud blob layout (dx/dy in unit-radius space, sr = blob scale)
    const CLOUD_BLOBS = [
      { dx: 0.0, dy: 0.0, sr: 0.44 },
      { dx: 0.38, dy: -0.28, sr: 0.37 },
      { dx: -0.38, dy: -0.22, sr: 0.35 },
      { dx: 0.52, dy: 0.22, sr: 0.31 },
      { dx: -0.5, dy: 0.28, sr: 0.32 },
      { dx: 0.18, dy: 0.48, sr: 0.3 },
      { dx: -0.22, dy: 0.44, sr: 0.28 },
      { dx: 0.42, dy: -0.46, sr: 0.27 },
      { dx: -0.42, dy: -0.42, sr: 0.25 },
    ];

    for (const fog of this.activeFogs) {
      const cx = fog.x - camX;
      const cy = fog.y - camY;
      const r = fog.radiusPx;
      const fadeIn = Math.min(1, (fog.totalFrames - fog.framesLeft) / 40);
      const fadeOut = Math.min(1, fog.framesLeft / 60);
      const alpha = Math.min(fadeIn, fadeOut);
      // Slow gentle swell
      const pulse = 0.92 + 0.08 * Math.sin(fog.framesLeft * 0.04);

      ctx.save();

      // Soft gray cloud blobs
      for (const blob of CLOUD_BLOBS) {
        const bx = cx + blob.dx * r;
        const by = cy + blob.dy * r;
        const br = blob.sr * r * pulse;
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, `rgba(215, 215, 225, ${alpha * 0.72})`);
        grad.addColorStop(0.55, `rgba(200, 200, 215, ${alpha * 0.45})`);
        grad.addColorStop(1, `rgba(185, 185, 205, 0)`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // Duration label
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#d0d0e0';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(fog.framesLeft / 60)}s`, cx, cy - r - 6);
      ctx.textAlign = 'left';

      ctx.restore();
    }
  }

  // ── Convenience accessors ───────────────────────────────────────────────────

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }

  // ── Stairwell helpers ────────────────────────────────────────────────────────

  private isEntityOnStairwell(entity: { x: number; y: number }): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
    // Stairwells are 2×2 tiles; check all four occupied tiles
    return this.gameMap.stairwellTiles.some(
      (s) => (tx === s.x || tx === s.x + 1) && (ty === s.y || ty === s.y + 1),
    );
  }

  private renderStairwells(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    canvas: HTMLCanvasElement,
  ): void {
    if (!this.levelDef.nextLevelId) return;
    const ts = TILE_SIZE;
    const bw = ts * 2; // 2-tile-wide block
    const bh = ts * 2; // 2-tile-tall block
    const pulse = 0.7 + Math.sin(Date.now() / 500) * 0.2;
    for (const { x, y } of this.gameMap.stairwellTiles) {
      const sx = x * ts - camX;
      const sy = y * ts - camY;
      if (sx < -bw || sx > canvas.width || sy < -bh || sy > canvas.height)
        continue;

      // Dark background (2×2 tiles)
      ctx.fillStyle = '#0d0718';
      ctx.fillRect(sx, sy, bw, bh);

      // Stair steps — 4 descending bands from amber to dark
      const stepCount = 4;
      const stepH = Math.floor(bh / stepCount);
      for (let i = 0; i < stepCount; i++) {
        const brightness = 180 - i * 35;
        ctx.fillStyle = `rgb(${brightness}, ${Math.floor(brightness * 0.55)}, 0)`;
        ctx.fillRect(sx + i * 6, sy + i * stepH, bw - i * 12, stepH + 1);
      }

      // Pulsing purple border
      ctx.strokeStyle = `rgba(168, 85, 247, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);

      // Down-arrow glyph — centred in the 2×2 block
      ctx.fillStyle = `rgba(233, 213, 255, ${pulse})`;
      ctx.font = `bold ${Math.floor(bh * 0.42)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx + bw / 2, sy + bh * 0.67);
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

    const mmSize = this.miniMapExpanded
      ? this.MM_EXPANDED_SIZE
      : this.MM_NORMAL_SIZE;
    const w = 80;
    const h = 28;
    const x = canvas.width - w - 88; // left of the pause button (which is 80+8 wide)
    const y = 8 + mmSize + 8;

    // Background — pulses red when urgent
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

  /** Returns screen-space rects for the two stairwell menu buttons. */
  private stairwellMenuRects(canvas: HTMLCanvasElement): {
    descend: { x: number; y: number; w: number; h: number };
    stay: { x: number; y: number; w: number; h: number };
  } {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
    const btnY = panelY + 110;
    return {
      descend: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
    };
  }

  private renderStairwellMenu(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const cw = canvas.width;
    const ch = canvas.height;

    // Dim backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#0d0920';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';

    // Title
    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('▼  Stairwell  ▼', cw / 2, panelY + 38);

    // Subtitle
    const nextId = this.levelDef.nextLevelId;
    const nextName = nextId ? getLevelDef(nextId).name : 'Next Floor';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`Descend to: ${nextName}?`, cw / 2, panelY + 68);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.fillText('(Esc or Stay to remain on this floor)', cw / 2, panelY + 88);

    const rects = this.stairwellMenuRects(canvas);

    // Descend button
    ctx.fillStyle = '#4c1d95';
    ctx.fillRect(
      rects.descend.x,
      rects.descend.y,
      rects.descend.w,
      rects.descend.h,
    );
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      rects.descend.x,
      rects.descend.y,
      rects.descend.w,
      rects.descend.h,
    );
    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(
      'Descend',
      rects.descend.x + rects.descend.w / 2,
      rects.descend.y + 27,
    );

    // Stay button
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Stay', rects.stay.x + rects.stay.w / 2, rects.stay.y + 27);

    ctx.textAlign = 'left';
  }

  /** Transition to the next level defined in levelDef.nextLevelId. */
  private descend(): void {
    if (!this.levelDef.nextLevelId) return;
    const nextDef = getLevelDef(this.levelDef.nextLevelId);
    this.sceneManager.replace(
      new DungeonScene(nextDef, this.input, this.sceneManager),
    );
  }

  // ── Mini-map helpers ─────────────────────────────────────────────────────────

  /**
   * Reveal all tiles within MM_REVEAL_RADIUS of (tileX, tileY) in the fog array.
   * Called every frame for the active player position.
   */
  private revealFogAround(tileX: number, tileY: number): void {
    const mapSize = this.gameMap.structure.length;
    const r = this.MM_REVEAL_RADIUS;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapSize && ty >= 0 && ty < mapSize) {
          this.fogOfWar[ty * mapSize + tx] = 1;
        }
      }
    }
  }

  /**
   * Reveal all tiles within the boss room bounds plus a 15-tile border.
   * Called once when the boss is defeated.
   */
  private revealBossNeighborhood(bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): void {
    const mapSize = this.gameMap.structure.length;
    const extra = 15;
    const x1 = Math.max(0, bounds.x - extra);
    const y1 = Math.max(0, bounds.y - extra);
    const x2 = Math.min(mapSize - 1, bounds.x + bounds.w + extra);
    const y2 = Math.min(mapSize - 1, bounds.y + bounds.h + extra);
    for (let ty = y1; ty <= y2; ty++) {
      for (let tx = x1; tx <= x2; tx++) {
        this.fogOfWar[ty * mapSize + tx] = 1;
      }
    }
  }

  /** Returns a mini-map colour for a given tile type number. */
  private miniMapTileColor(type: number): string {
    // Tile type constants (mirrored from GameMap internals)
    switch (type) {
      case 9:
        return '#000000'; // void border
      case 2:
        return '#3a3028'; // wall
      case 0:
        return '#3a7040'; // grass
      case 1:
        return '#6a5040'; // road
      case 4:
        return '#1a6880'; // water
      case 5:
        return '#606060'; // concrete (hallway)
      case 6:
        return '#707070'; // tile floor
      case 7:
        return '#503030'; // carpet
      case 8:
        return '#704030'; // wood
      case 10:
        return '#8a7040'; // safe room floor
      case 11:
        return '#2a1808'; // boss room floor
      default:
        return '#555555';
    }
  }

  /**
   * Renders the mini-map in the top-right corner.
   * Normal mode: 160×160 px at 2 px/tile.
   * Expanded mode (M key): 240×240 px at 1 px/tile.
   */
  private renderMiniMap(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const mapSize = this.gameMap.structure.length;
    const expanded = this.miniMapExpanded;
    const mmSize = expanded ? this.MM_EXPANDED_SIZE : this.MM_NORMAL_SIZE;
    const pxPerTile = expanded ? 1 : 2;
    const tilesInView = Math.floor(mmSize / pxPerTile);
    const halfTiles = Math.floor(tilesInView / 2);

    const mmX = canvas.width - mmSize - 8;
    const mmY = 8;

    const active = this.active();
    const playerTX = Math.floor((active.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const playerTY = Math.floor((active.y + TILE_SIZE * 0.5) / TILE_SIZE);

    // ── Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

    // ── Clip to mini-map bounds ────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // ── Draw tiles ─────────────────────────────────────────────────────────
    for (let dy = -halfTiles; dy <= halfTiles; dy++) {
      for (let dx = -halfTiles; dx <= halfTiles; dx++) {
        const tx = playerTX + dx;
        const ty = playerTY + dy;
        if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;

        const px = mmX + (dx + halfTiles) * pxPerTile;
        const py = mmY + (dy + halfTiles) * pxPerTile;

        const revealed = this.fogOfWar[ty * mapSize + tx] === 1;
        if (!revealed) {
          ctx.fillStyle = '#111';
          ctx.fillRect(px, py, pxPerTile, pxPerTile);
          continue;
        }

        const tile = this.gameMap.structure[ty]?.[tx];
        ctx.fillStyle = tile ? this.miniMapTileColor(tile.type) : '#555';
        ctx.fillRect(px, py, pxPerTile, pxPerTile);
      }
    }

    // ── Stairwells — white squares (always visible if revealed) ────────────
    for (const st of this.gameMap.stairwellTiles) {
      if (!this.fogOfWar[st.y * mapSize + st.x]) continue;
      const sx = mmX + (st.x - playerTX + halfTiles) * pxPerTile - 1;
      const sy = mmY + (st.y - playerTY + halfTiles) * pxPerTile - 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, pxPerTile + 2, pxPerTile + 2);
    }

    // ── Corpse markers — X ─────────────────────────────────────────────
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    for (const corpse of this.corpseMarkers) {
      const ctx2TX = Math.floor(corpse.x / TILE_SIZE);
      const ctx2TY = Math.floor(corpse.y / TILE_SIZE);
      if (!this.fogOfWar[ctx2TY * mapSize + ctx2TX]) continue;
      const cx =
        mmX +
        (ctx2TX - playerTX + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      const cy =
        mmY +
        (ctx2TY - playerTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 2);
      ctx.lineTo(cx + 2, cy + 2);
      ctx.moveTo(cx + 2, cy - 2);
      ctx.lineTo(cx - 2, cy + 2);
      ctx.stroke();
    }

    // ── Mobs — red dots (only within 20-tile radar range) ─────────────────
    const MOB_RADAR_PX = TILE_SIZE * 20;
    ctx.fillStyle = '#ef4444';
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      if (Math.hypot(mob.x - active.x, mob.y - active.y) > MOB_RADAR_PX)
        continue;
      const mobTX = Math.floor((mob.x + TILE_SIZE * 0.5) / TILE_SIZE);
      const mobTY = Math.floor((mob.y + TILE_SIZE * 0.5) / TILE_SIZE);
      if (!this.fogOfWar[mobTY * mapSize + mobTX]) continue;
      const mx =
        mmX +
        (mobTX - playerTX + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      const my =
        mmY +
        (mobTY - playerTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Companion player — blue dot (always visible) ───────────────────────
    const companion = this.inactive();
    const compTX = Math.floor((companion.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const compTY = Math.floor((companion.y + TILE_SIZE * 0.5) / TILE_SIZE);
    const compSX =
      mmX +
      (compTX - playerTX + halfTiles) * pxPerTile +
      Math.floor(pxPerTile / 2);
    const compSY =
      mmY +
      (compTY - playerTY + halfTiles) * pxPerTile +
      Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(compSX, compSY, 2, 0, Math.PI * 2);
    ctx.fill();

    // ── Mordecai (friendly NPC) — white dot if revealed ───────────────────
    if (this.gameMap.safeRoomCentre) {
      const morcTX = this.mordecaiTileX;
      const morcTY = this.mordecaiTileY;
      if (this.fogOfWar[morcTY * mapSize + morcTX]) {
        const msx =
          mmX +
          (morcTX - playerTX + halfTiles) * pxPerTile +
          Math.floor(pxPerTile / 2);
        const msy =
          mmY +
          (morcTY - playerTY + halfTiles) * pxPerTile +
          Math.floor(pxPerTile / 2);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(msx, msy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Active player — green dot (always at centre) ───────────────────────
    const playerSX = mmX + halfTiles * pxPerTile + Math.floor(pxPerTile / 2);
    const playerSY = mmY + halfTiles * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(playerSX, playerSY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Border ─────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // ── Expand hint ────────────────────────────────────────────────────────
    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      expanded ? 'M: collapse' : 'M: expand',
      mmX + mmSize / 2,
      mmY + mmSize + 9,
    );
    ctx.textAlign = 'left';
  }
}
