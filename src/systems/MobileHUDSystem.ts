import { platform } from '../core/Platform';
import { InventoryPanel } from '../ui/InventoryPanel';
import { GearPanel } from '../ui/GearPanel';
import { TILE_SIZE } from '../core/constants';
import type { Inventory } from '../core/Inventory';
import type { GameMap } from '../map/GameMap';
import type { GameSystem } from './GameSystem';
import { pointInRect } from '../utils';
import { drawText } from '../ui/TextBox';

type Rect = { x: number; y: number; w: number; h: number };

// Mobile button constants
const MOBILE_BTN_WIDTH = 80;
const MOBILE_BTN_HEIGHT = 52;
const MOBILE_BTN_BOTTOM_MARGIN = 12;
const MOBILE_BTN_LEFT_MARGIN = 10;
const MOBILE_BTN_BOTTOM_OFFSET = 8;
const MOBILE_SMALL_BTN_WIDTH = 80;
const MOBILE_SMALL_BTN_HEIGHT = 28;
const MOBILE_GEAR_BAG_X_OFFSET = 88;
const MOBILE_GEAR_BAG_Y_DEFAULT = 38;
const MOBILE_GEAR_BAG_Y_OFFSET = 34;

// Minimap constants
const MINIMAP_EXPANDED_SIZE = 180;
const MINIMAP_NORMAL_SIZE = 100;
const MINIMAP_X_OFFSET = 8;
const MINIMAP_Y_OFFSET = 8;
const MINIMAP_EXPANDED_ALPHA = 0.82;
const DOT_COMPANION_SIZE = 0.4;
const DOT_PLAYER_SIZE = 0.5;
const DOT_COMPANION_RADIUS = 2;
const DOT_PLAYER_RADIUS = 2.5;
const DOT_EXIT_RADIUS = 1.5;

// Button styling
const ICON_FONT_SIZE = 20;
const ICON_Y_OFFSET = 2;
const LABEL_Y_OFFSET_1 = 6;
const LABEL_Y_OFFSET_2 = 7;
const LABEL_SIZE = 9;
const SMALL_LABEL_SIZE = 12;
const SMALL_LABEL_Y_OFFSET = 4;
const SMALL_LABEL_Y_BASELINE = 10;
const BUTTON_BORDER_WIDTH = 1.5;
const SMALL_BUTTON_BORDER_WIDTH = 1;
const BUTTON_LINE_WIDTH = 1;

// Minimap text
const MINIMAP_HINT_Y_OFFSET = 9;
const MINIMAP_HINT_Y_BASELINE = 6;
const MINIMAP_HINT_SIZE = 8;

// Touch interaction
const TAP_DURATION_MAX_MS = 250;
const TAP_DISTANCE_MAX_PX = 20;
const LONG_PRESS_DURATION_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

// Minimap marker sizes
const TILE_CENTER_OFFSET = 0.5;

// Tile type constants for minimap colors
const TILE_TYPE_WALL = 9;
const TILE_TYPE_WALL_SHADOW = 2;
const TILE_TYPE_GRASS = 0;
const TILE_TYPE_FLOOR = 1;
const TILE_TYPE_WATER = 4;
const TILE_TYPE_METAL = 5;
const TILE_TYPE_METAL_2 = 6;
const TILE_TYPE_LAVA = 7;
const TILE_TYPE_BRICK = 8;
const TILE_TYPE_BOSS_FLOOR = 10;
const TILE_TYPE_GRIME_FLOOR = 11;
const TILE_TYPE_RUBBER_FLOOR = 12;

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
  private _extraBtnRects = new Map<string, Rect>();

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
    hotbarHeight = MOBILE_BTN_HEIGHT,
    topRightY?: number,
  ): void {
    if (!platform.isMobile) return;

    const btnY =
      canvas.height -
      hotbarHeight -
      MOBILE_BTN_BOTTOM_MARGIN -
      MOBILE_BTN_HEIGHT -
      MOBILE_BTN_BOTTOM_OFFSET;

    // Switch button (bottom-left)
    this._switchBtnRect = {
      x: MOBILE_BTN_LEFT_MARGIN,
      y: btnY,
      w: MOBILE_BTN_WIDTH,
      h: MOBILE_BTN_HEIGHT,
    };
    this.drawBtn(
      ctx,
      this._switchBtnRect,
      humanActive ? '🐱' : '🧍',
      humanActive ? 'Cat' : 'Human',
      false,
    );

    // Extra large buttons (bottom-right, same row as Switch)
    this._extraBtnRects.clear();
    let extraX = canvas.width - MOBILE_BTN_LEFT_MARGIN - MOBILE_BTN_WIDTH;
    for (const btn of extraButtons) {
      const rect: Rect = { x: extraX, y: btnY, w: MOBILE_BTN_WIDTH, h: MOBILE_BTN_HEIGHT };
      this._extraBtnRects.set(btn.id, rect);
      this.drawBtn(ctx, rect, btn.icon, btn.label, btn.active);
      extraX -= MOBILE_BTN_WIDTH + MOBILE_BTN_BOTTOM_OFFSET;
    }

    // Gear / Bag small buttons (top-right area)
    const gearY = topRightY ?? MOBILE_GEAR_BAG_Y_DEFAULT;
    const rightX = canvas.width - MOBILE_GEAR_BAG_X_OFFSET;
    this._gearBtnRect = {
      x: rightX,
      y: gearY,
      w: MOBILE_SMALL_BTN_WIDTH,
      h: MOBILE_SMALL_BTN_HEIGHT,
    };
    this._bagBtnRect = {
      x: rightX,
      y: gearY + MOBILE_GEAR_BAG_Y_OFFSET,
      w: MOBILE_SMALL_BTN_WIDTH,
      h: MOBILE_SMALL_BTN_HEIGHT,
    };
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
    const y = topY ?? MOBILE_GEAR_BAG_Y_DEFAULT;
    const rightX = canvas.width - MOBILE_GEAR_BAG_X_OFFSET;
    this._pauseBtnRect = { x: rightX, y, w: MOBILE_SMALL_BTN_WIDTH, h: MOBILE_SMALL_BTN_HEIGHT };
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
    const mmSize = this._miniMapExpanded ? MINIMAP_EXPANDED_SIZE : MINIMAP_NORMAL_SIZE;

    const mmX = canvas.width - mmSize - MINIMAP_X_OFFSET;
    const mmY = MINIMAP_Y_OFFSET;
    this._miniMapRect = { x: mmX, y: mmY, w: mmSize, h: mmSize };

    // Scale to fit the map in the square
    const maxDim = Math.max(mapW, mapH);
    const pxPerTile = mmSize / maxDim;
    const offsetX = (mmSize - mapW * pxPerTile) / 2;
    const offsetY = (mmSize - mapH * pxPerTile) / 2;

    // Background
    ctx.fillStyle = `rgba(0,0,0,${MINIMAP_EXPANDED_ALPHA})`;
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Tiles
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        const tile = gameMap.structure[ty][tx];
        const px = mmX + offsetX + tx * pxPerTile;
        const py = mmY + offsetY + ty * pxPerTile;
        ctx.fillStyle = this.tileColor(tile.type);
        ctx.fillRect(px, py, Math.ceil(pxPerTile), Math.ceil(pxPerTile));
      }
    }

    // Exit tiles — yellow dots
    ctx.fillStyle = '#facc15';
    for (const t of gameMap._interiorExitTiles) {
      const ex = mmX + offsetX + (t.x + TILE_CENTER_OFFSET) * pxPerTile;
      const ey = mmY + offsetY + (t.y + TILE_CENTER_OFFSET) * pxPerTile;
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(DOT_EXIT_RADIUS, pxPerTile * DOT_COMPANION_SIZE), 0, Math.PI * 2);
      ctx.fill();
    }

    // Companion — blue dot
    const compTX = (companion.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE;
    const compTY = (companion.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE;
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(
      mmX + offsetX + compTX * pxPerTile,
      mmY + offsetY + compTY * pxPerTile,
      Math.max(DOT_COMPANION_RADIUS, pxPerTile * DOT_COMPANION_SIZE),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Active player — green dot
    const playerTX = (active.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE;
    const playerTY = (active.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(
      mmX + offsetX + playerTX * pxPerTile,
      mmY + offsetY + playerTY * pxPerTile,
      Math.max(DOT_PLAYER_RADIUS, pxPerTile * DOT_PLAYER_SIZE),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = BUTTON_LINE_WIDTH;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Expand hint
    const hint = platform.miniMapHint(this._miniMapExpanded);
    drawText(ctx, hint, {
      x: mmX + mmSize / 2,
      y: mmY + mmSize + MINIMAP_HINT_Y_OFFSET - MINIMAP_HINT_Y_BASELINE,
      size: MINIMAP_HINT_SIZE,
      color: '#64748b',
      align: 'center',
    });

    return mmSize;
  }

  toggleMiniMap(): void {
    this._miniMapExpanded = !this._miniMapExpanded;
  }

  get miniMapSize(): number {
    return this._miniMapExpanded ? MINIMAP_EXPANDED_SIZE : MINIMAP_NORMAL_SIZE;
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
    return elapsed < TAP_DURATION_MAX_MS && moved < TAP_DISTANCE_MAX_PX;
  }

  /** Returns how long the current touch has been held (ms), or 0. */
  get touchHoldMs(): number {
    return this.tapStart ? Date.now() - this.tapStart.time : 0;
  }

  startInvLongPress(x: number, y: number, onLongPress: () => void): void {
    this.clearInvLongPress();
    this.invLongPressPos = { x, y };
    this.invLongPressFired = false;
    this.invLongPressTimer = setTimeout(() => {
      this.invLongPressFired = true;
      this.inventoryPanel.cancelDrag();
      onLongPress();
    }, LONG_PRESS_DURATION_MS);
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
      if (dist > LONG_PRESS_MOVE_THRESHOLD) this.clearInvLongPress();
    }
  }

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
    ctx.lineWidth = BUTTON_BORDER_WIDTH;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.textAlign = 'center';
    ctx.font = `bold ${ICON_FONT_SIZE}px monospace`;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(icon, r.x + r.w / 2, r.y + r.h / 2 + ICON_Y_OFFSET);
    ctx.textAlign = 'left';
    drawText(ctx, label, {
      x: r.x + r.w / 2,
      y: r.y + r.h - LABEL_Y_OFFSET_1 - LABEL_Y_OFFSET_2,
      size: LABEL_SIZE,
      color: '#94a3b8',
      align: 'center',
    });
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
    ctx.lineWidth = SMALL_BUTTON_BORDER_WIDTH;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    drawText(ctx, label, {
      x: r.x + r.w / 2,
      y: r.y + r.h / 2 + SMALL_LABEL_Y_OFFSET - SMALL_LABEL_Y_BASELINE,
      size: SMALL_LABEL_SIZE,
      color: '#e2e8f0',
      align: 'center',
    });
  }

  private hitRect(x: number, y: number, r: Rect): boolean {
    return pointInRect(x, y, r);
  }

  private tileColor(type: number): string {
    switch (type) {
      case TILE_TYPE_WALL:
        return '#000000';
      case TILE_TYPE_WALL_SHADOW:
        return '#3a3028';
      case TILE_TYPE_GRASS:
        return '#3a7040';
      case TILE_TYPE_FLOOR:
        return '#6a5040';
      case TILE_TYPE_WATER:
        return '#1a6880';
      case TILE_TYPE_METAL:
        return '#606060';
      case TILE_TYPE_METAL_2:
        return '#707070';
      case TILE_TYPE_LAVA:
        return '#503030';
      case TILE_TYPE_BRICK:
        return '#704030';
      case TILE_TYPE_BOSS_FLOOR:
        return '#8a7040';
      case TILE_TYPE_GRIME_FLOOR:
        return '#2a1808';
      case TILE_TYPE_RUBBER_FLOOR:
        return '#1a1a1a';
      default:
        return '#555555';
    }
  }
}
