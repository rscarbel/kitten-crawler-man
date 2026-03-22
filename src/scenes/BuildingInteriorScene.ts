import { SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
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
import { readMovement, applyMovement } from '../systems/GameLoopPhases';
import { GameplayScene } from './GameplayScene';

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

export class BuildingInteriorScene extends GameplayScene {
  private map: GameMap;
  readonly pm: PlayerManager;
  private mapW: number;
  private mapH: number;

  // Exit menu state
  private onExitTile = false;
  private exitMenuOpen = false;
  private exitDismissed = false;

  // Safe room (restaurant only)
  private readonly safeRoom: SafeRoomSystem | null;

  // Shop (store only)
  private readonly shop: ShopSystem | null;

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

  constructor(
    private readonly entry: BuildingEntry,
    humanSnap: PlayerSnapshot,
    catSnap: PlayerSnapshot,
    input: InputManager,
    sceneManager: SceneManager,
    private readonly onExitCallback: (humanSnap: PlayerSnapshot, catSnap: PlayerSnapshot) => void,
  ) {
    super(input, sceneManager);

    const isTower = entry.type === 'tower';

    if (isTower) {
      // Generate 4 tower floors
      for (let f = 0; f < 4; f++) {
        const floorMap = new GameMap({
          mapSize: 0,
          tileHeight: TILE_SIZE,
          numBossRooms: 0,
          numSafeRooms: 0,
        });
        floorMap.generateInterior('tower', f, entry.name);
        this.towerFloors.push(floorMap);
      }
      this.map = this.towerFloors[0];
    } else {
      // Build single interior map
      this.map = new GameMap({
        mapSize: 0,
        tileHeight: TILE_SIZE,
        numBossRooms: 0,
        numSafeRooms: 0,
      });
      this.map.generateInterior(entry.type, 0, entry.name);
    }

    this.mapW = this.map.structure[0]?.length ?? 18;
    this.mapH = this.map.structure.length;

    const { x: sx, y: sy } = this.map.startTile;
    this.pm = new PlayerManager(sx, sy);
    this.cat.setMap(this.map);

    restorePlayer(this.human, humanSnap);
    restorePlayer(this.cat, catSnap);

    // Re-position after restore (restore doesn't set x/y).
    this.pm.setPositions(sx, sy);

    this.safeRoom =
      entry.type === 'restaurant' ? new SafeRoomSystem(this.map, sx, sy, 'level3') : null;

    this.shop = entry.type === 'store' ? new ShopSystem(this.mapW) : null;

    // Tower stair system
    if (isTower) {
      this.towerStairs = new TowerStairSystem(
        this.map,
        0,
        () => this.changeFloor(this.currentFloor + 1),
        () => this.changeFloor(this.currentFloor - 1),
      );
    }
  }

  private changeFloor(newFloor: number): void {
    if (newFloor < 0 || newFloor > 3) return;
    const goingUp = newFloor > this.currentFloor;
    this.currentFloor = newFloor;
    this.map = this.towerFloors[newFloor];
    this.mapW = this.map.structure[0]?.length ?? 30;
    this.mapH = this.map.structure.length;
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
  }

  onEnter(): void {
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
    if (this.pauseMenu.isOpen) return;
    if (this.exitMenuOpen) return;
    if (this.towerStairs?.menuOpen) return;
    if (this.safeRoom?.mordecaiDialogOpen) return;
    if (this.shop?.shopOpen) return;

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
    const followDist = this.isFollowOverride ? TILE_SIZE * 0.8 : TILE_SIZE * 1.5;
    this.applyCompanionFollow(this.map, followDist);

    // Tab: switch active player
    if (this.input.has('Tab')) {
      this.input.clear();
      this.pm.switchActive();
    }

    // Safe room: sleep / talk to Mordecai
    if (this.safeRoom && this.input.has(' ')) {
      this.input.clear();
      if (this.safeRoom.isNearBed(player)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        this.safeRoom.mordecaiDialogOpen = true;
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

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();
    this.safeRoom?.updateWander();
    this.shop?.update();

    // Exit tile detection
    const ptx = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const pty = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
    const wasOnExit = this.onExitTile;
    this.onExitTile = this.map._interiorExitTiles.some((t) => t.x === ptx && t.y === pty);
    if (!this.onExitTile) {
      this.exitDismissed = false;
    } else if (!wasOnExit && !this.exitDismissed) {
      this.exitMenuOpen = true;
    }

    // Tower stair detection
    this.towerStairs?.detect(player);
  }

  handleClick(mx: number, my: number): void {
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

  private doExit(): void {
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    this.onExitCallback(humanSnap, catSnap);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const canvas = this.sceneManager.canvas;
    const { x: camX, y: camY } = this.computeCamera(this.map);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.map.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);

    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    if (this.safeRoom) {
      const pulse = 0.6 + Math.sin(Date.now() / 600) * 0.3;
      this.safeRoom.renderObjects(ctx, camX, camY, this.active(), pulse);
    }

    if (this.shop) {
      this.shop.renderObjects(ctx, camX, camY, this.active());
    }

    // Exit hint above door
    this.renderExitHint(ctx, camX, camY);

    // Tower stair hints
    this.towerStairs?.renderStairHints(ctx, camX, camY);

    this.renderHUD(ctx, canvas);

    // Interior label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, 28);
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    const floorSuffix = this.towerFloors.length > 0 ? ` (${FLOOR_LABELS[this.currentFloor]})` : '';
    ctx.fillText(`Inside: ${this.entry.name}${floorSuffix}`, canvas.width / 2, 18);
    ctx.textAlign = 'left';

    // Minimap + right-side buttons (pause, gear, bag)
    if (!this.exitMenuOpen && !this.pauseMenu.isOpen) {
      const mmSize = this.mobileHUD.renderInteriorMiniMap(
        ctx,
        canvas,
        this.map,
        this.active(),
        this.inactive(),
      );
      const pauseY = 8 + mmSize + 20;
      this.mobileHUD.renderPauseButton(ctx, canvas, pauseY);
      const gearY = pauseY + 34;

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
        this.mobileHUD.renderButtons(ctx, canvas, this.human.isActive, extraButtons, 52, gearY);
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

    if (this.exitMenuOpen) this.renderExitMenu(ctx, canvas);
    if (this.towerStairs?.menuOpen) this.towerStairs.renderMenu(ctx, canvas);

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.render(ctx, canvas, this.human, this.cat);
    }
  }

  private renderExitHint(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const pulse = 0.6 + Math.sin(Date.now() / 500) * 0.3;
    for (const t of this.map._interiorExitTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      ctx.fillStyle = `rgba(250,220,80,${pulse})`;
      ctx.font = `bold ${Math.floor(TILE_SIZE * 0.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx, sy - 2);
      ctx.textAlign = 'left';
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

    ctx.textAlign = 'center';
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('▼  Exit Building  ▼', cw / 2, panelY + 36);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`Leave ${this.entry.name}?`, cw / 2, panelY + 68);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.fillText('(Esc or Stay to remain inside)', cw / 2, panelY + 88);

    const rects = this.menuRects(canvas);

    ctx.fillStyle = '#1a4d0d';
    ctx.fillRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Exit', rects.exit.x + rects.exit.w / 2, rects.exit.y + 27);

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

  private menuRects(canvas: HTMLCanvasElement) {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
    const btnY = panelY + 110;
    return {
      exit: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
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
        this.shop?.shopOpen
      ) {
        this.handleClick(x, y);
        continue;
      }

      // HUD collapse/expand toggle (mobile only)
      if (platform.isMobile) {
        const ht = this._hudToggleRect;
        if (x >= ht.x && x <= ht.x + ht.w && y >= ht.y && y <= ht.y + ht.h) {
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
          if (this.mobileHUD.inventoryDragTouchId === null) {
            this.mobileHUD.inventoryDragTouchId = touch.identifier;
          }
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
              this.safeRoom.mordecaiDialogOpen = true;
            }
          }
          if (this.shop && !this.exitMenuOpen) {
            if (this.shop.isNearShopkeeper(this.active())) {
              this.shop.shopOpen = true;
            }
          }
        }
        this.mobileHUD.clearMovement();
      }
    }
  }

  private triggerHotbarActivation(hotbarIdx: number): void {
    const active = this.active();
    const slot = active.inventory.hotbar[hotbarIdx];
    if (slot?.id === 'health_potion') {
      active.usePotion();
    }
  }
}
