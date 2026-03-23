import { platform } from '../core/Platform';
import { InventoryPanel } from '../ui/InventoryPanel';
import { GearPanel } from '../ui/GearPanel';
import { TILE_SIZE } from '../core/constants';
import type { Inventory } from '../core/Inventory';
import type { GameMap } from '../map/GameMap';
import type { GameSystem } from './GameSystem';
import { pointInRect } from '../utils';

type Rect = { x: number; y: number; w: number; h: number };

export interface MobileHUDButton {
  id: string;
  icon: string;
  label: string;
  active: boolean;
}

/**
 * Shared mobile HUD system: renders Switch / Gear / Bag buttons,
 * manages touch-movement state, and provides inventory/gear panel wiring.
 *
 * Used by both DungeonScene and BuildingInteriorScene so mobile UI stays
 * consistent without duplicating rendering or hit-testing code.
 */
export class MobileHUDSystem implements GameSystem {
  dispose(): void {
    /* no-op */
  }

  // Touch movement state
  moveTouchId: number | null = null;
  moveTarget: { x: number; y: number } | null = null;
  tapStart: { x: number; y: number; time: number } | null = null;

  // Inventory drag state
  inventoryDragTouchId: number | null = null;
  private invLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  private invLongPressPos: { x: number; y: number } | null = null;
  invLongPressFired = false;

  // Button rects (updated each render frame)
  private _switchBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private _gearBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  private _bagBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  private _pauseBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  private _miniMapRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  private _extraBtnRects: Map<string, Rect> = new Map();

  // Interior minimap state
  private _miniMapExpanded = false;

  // Shared UI panels
  readonly inventoryPanel = new InventoryPanel();
  readonly gearPanel = new GearPanel();

  /**
   * Render the standard mobile buttons: Switch + Gear + Bag,
   * plus any extra buttons passed in (e.g. Follow for DungeonScene).
   *
   * @param extraButtons - Additional large buttons rendered on the right side
   *   (same row as Switch). Pass [] for scenes that don't need them.
   * @param hotbarHeight - Height of the hotbar area at the bottom. Defaults to 52.
   * @param topRightY - Y position for the small Gear/Bag buttons. If not given,
   *   they render at y=38 (below a typical header bar).
   */
  renderButtons(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    humanActive: boolean,
    extraButtons: MobileHUDButton[] = [],
    hotbarHeight = 52,
    topRightY?: number,
  ): void {
    if (!platform.isMobile) return;

    const BOTTOM_MARGIN = 12;
    const BTN_W = 80;
    const BTN_H = 52;
    const MARGIN = 10;
    const btnY = canvas.height - hotbarHeight - BOTTOM_MARGIN - BTN_H - 8;

    // Switch button (bottom-left)
    this._switchBtnRect = { x: MARGIN, y: btnY, w: BTN_W, h: BTN_H };
    this.drawBtn(
      ctx,
      this._switchBtnRect,
      humanActive ? '🐱' : '🧍',
      humanActive ? 'Cat' : 'Human',
      false,
    );

    // Extra large buttons (bottom-right, same row as Switch)
    this._extraBtnRects.clear();
    let extraX = canvas.width - MARGIN - BTN_W;
    for (const btn of extraButtons) {
      const rect: Rect = { x: extraX, y: btnY, w: BTN_W, h: BTN_H };
      this._extraBtnRects.set(btn.id, rect);
      this.drawBtn(ctx, rect, btn.icon, btn.label, btn.active);
      extraX -= BTN_W + 8;
    }

    // Gear / Bag small buttons (top-right area)
    const gearY = topRightY ?? 38;
    const rightX = canvas.width - 88;
    this._gearBtnRect = { x: rightX, y: gearY, w: 80, h: 28 };
    this._bagBtnRect = { x: rightX, y: gearY + 34, w: 80, h: 28 };
    this.drawSmallBtn(ctx, this._gearBtnRect, 'Gear', this.gearPanel.isOpen);
    this.drawSmallBtn(ctx, this._bagBtnRect, 'Bag', this.inventoryPanel.isOpen);
  }

  /**
   * Render the inventory hotbar + open panels.
   * Call this from the scene's render method.
   */
  renderPanels(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
    coins: number,
  ): void {
    this.inventoryPanel.render(ctx, canvas, inventory, playerName, coins);
    this.gearPanel.render(ctx, canvas, inventory, playerName);
  }

  /**
   * Render a pause button. Position is relative to the minimap or top-right area.
   */
  renderPauseButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, topY?: number): void {
    const y = topY ?? 38;
    const rightX = canvas.width - 88;
    this._pauseBtnRect = { x: rightX, y, w: 80, h: 28 };
    this.drawSmallBtn(ctx, this._pauseBtnRect, platform.pauseButtonLabel, false);
  }

  /**
   * Render a simple interior minimap (no fog of war, shows full layout).
   * Returns the minimap size so callers can position elements below it.
   */
  renderInteriorMiniMap(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    gameMap: GameMap,
    active: { x: number; y: number },
    companion: { x: number; y: number },
  ): number {
    const mapW = gameMap.structure[0]?.length ?? 1;
    const mapH = gameMap.structure.length;
    const mmSize = this._miniMapExpanded ? 180 : 100;

    const mmX = canvas.width - mmSize - 8;
    const mmY = 8;
    this._miniMapRect = { x: mmX, y: mmY, w: mmSize, h: mmSize };

    // Scale to fit the map in the square
    const maxDim = Math.max(mapW, mapH);
    const pxPerTile = mmSize / maxDim;
    const offsetX = (mmSize - mapW * pxPerTile) / 2;
    const offsetY = (mmSize - mapH * pxPerTile) / 2;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Tiles
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        const tile = gameMap.structure[ty]?.[tx];
        if (!tile) continue;
        const px = mmX + offsetX + tx * pxPerTile;
        const py = mmY + offsetY + ty * pxPerTile;
        ctx.fillStyle = this.tileColor(tile.type);
        ctx.fillRect(px, py, Math.ceil(pxPerTile), Math.ceil(pxPerTile));
      }
    }

    // Exit tiles — yellow dots
    if (gameMap._interiorExitTiles) {
      ctx.fillStyle = '#facc15';
      for (const t of gameMap._interiorExitTiles) {
        const ex = mmX + offsetX + (t.x + 0.5) * pxPerTile;
        const ey = mmY + offsetY + (t.y + 0.5) * pxPerTile;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(1.5, pxPerTile * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Companion — blue dot
    const compTX = (companion.x + TILE_SIZE * 0.5) / TILE_SIZE;
    const compTY = (companion.y + TILE_SIZE * 0.5) / TILE_SIZE;
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(
      mmX + offsetX + compTX * pxPerTile,
      mmY + offsetY + compTY * pxPerTile,
      Math.max(2, pxPerTile * 0.4),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Active player — green dot
    const playerTX = (active.x + TILE_SIZE * 0.5) / TILE_SIZE;
    const playerTY = (active.y + TILE_SIZE * 0.5) / TILE_SIZE;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(
      mmX + offsetX + playerTX * pxPerTile,
      mmY + offsetY + playerTY * pxPerTile,
      Math.max(2.5, pxPerTile * 0.5),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Expand hint
    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    const hint = platform.miniMapHint(this._miniMapExpanded);
    ctx.fillText(hint, mmX + mmSize / 2, mmY + mmSize + 9);
    ctx.textAlign = 'left';

    return mmSize;
  }

  toggleMiniMap(): void {
    this._miniMapExpanded = !this._miniMapExpanded;
  }

  get miniMapSize(): number {
    return this._miniMapExpanded ? 180 : 100;
  }

  /**
   * Hit-test a touch/click point against mobile buttons.
   * Returns the button id ('switch', 'gear', 'bag', 'pause', 'minimap',
   * or a custom extra id), or null.
   */
  hitTest(x: number, y: number): string | null {
    if (this.hitRect(x, y, this._miniMapRect)) return 'minimap';
    if (this.hitRect(x, y, this._pauseBtnRect)) return 'pause';
    if (this.hitRect(x, y, this._switchBtnRect)) return 'switch';
    if (this.hitRect(x, y, this._gearBtnRect)) return 'gear';
    if (this.hitRect(x, y, this._bagBtnRect)) return 'bag';
    for (const [id, rect] of this._extraBtnRects) {
      if (this.hitRect(x, y, rect)) return id;
    }
    return null;
  }

  /** Clear touch-movement state (call on touch end). */
  clearMovement(): void {
    this.moveTouchId = null;
    this.moveTarget = null;
    this.tapStart = null;
  }

  /** Start tracking a movement touch. */
  startMovement(touchId: number, x: number, y: number): void {
    this.moveTouchId = touchId;
    this.moveTarget = { x, y };
    this.tapStart = { x, y, time: Date.now() };
  }

  /** Returns true if we are mid-tap (below 250ms and <20px moved). */
  isTap(x: number, y: number): boolean {
    if (!this.tapStart) return false;
    const elapsed = Date.now() - this.tapStart.time;
    const moved = Math.hypot(x - this.tapStart.x, y - this.tapStart.y);
    return elapsed < 250 && moved < 20;
  }

  /** Returns how long the current touch has been held (ms), or 0. */
  get touchHoldMs(): number {
    return this.tapStart ? Date.now() - this.tapStart.time : 0;
  }

  // --- Inventory drag / long-press helpers ---

  startInvLongPress(x: number, y: number, onLongPress: () => void): void {
    this.clearInvLongPress();
    this.invLongPressPos = { x, y };
    this.invLongPressFired = false;
    this.invLongPressTimer = setTimeout(() => {
      this.invLongPressFired = true;
      this.inventoryPanel.cancelDrag();
      onLongPress();
    }, 500);
  }

  clearInvLongPress(): void {
    if (this.invLongPressTimer !== null) {
      clearTimeout(this.invLongPressTimer);
      this.invLongPressTimer = null;
    }
    this.invLongPressPos = null;
    this.invLongPressFired = false;
  }

  checkInvLongPressMove(x: number, y: number): void {
    if (this.invLongPressPos) {
      const dist = Math.hypot(x - this.invLongPressPos.x, y - this.invLongPressPos.y);
      if (dist > 10) this.clearInvLongPress();
    }
  }

  // --- Mouse/touch forwarding to panels ---

  handleMouseDown(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.inventoryPanel.handleMouseDown(mx, my, canvas, inventory);
  }

  handleMouseMove(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.inventoryPanel.handleMouseMove(mx, my);
    this.gearPanel.handleMouseMove(mx, my, canvas, inventory);
  }

  handleMouseUp(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.inventoryPanel.handleMouseUp(mx, my, canvas, inventory);
  }

  handleContextMenu(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.inventoryPanel.openContextMenu(mx, my, canvas, inventory);
  }

  // --- Private drawing helpers ---

  private drawBtn(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    icon: string,
    label: string,
    active: boolean,
  ): void {
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
  }

  private drawSmallBtn(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    label: string,
    active: boolean,
  ): void {
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
  }

  private hitRect(x: number, y: number, r: Rect): boolean {
    return pointInRect(x, y, r);
  }

  private tileColor(type: number): string {
    switch (type) {
      case 9:
        return '#000000';
      case 2:
        return '#3a3028';
      case 0:
        return '#3a7040';
      case 1:
        return '#6a5040';
      case 4:
        return '#1a6880';
      case 5:
        return '#606060';
      case 6:
        return '#707070';
      case 7:
        return '#503030';
      case 8:
        return '#704030';
      case 10:
        return '#8a7040';
      case 11:
        return '#2a1808';
      case 12:
        return '#1a1a1a';
      default:
        return '#555555';
    }
  }
}
