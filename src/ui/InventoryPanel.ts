import type { Inventory } from '../core/Inventory';
import { HOTBAR_COUNT, SLOTS_PER_PAGE, QUEST_SLOT_IDX } from '../core/ItemDefs';
import type { InventoryItem } from '../core/ItemDefs';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { platform } from '../core/Platform';
import { drawDynamiteInventoryIcon } from '../sprites/dynamiteSprite';
import {
  drawDumbbellInventoryIcon,
  drawBenchPressInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../sprites/gymEquipmentSprite';
import { drawWoodPileSprite } from '../sprites/questNPCSprite';
import { InventoryInteraction } from './InventoryInteraction';
import { drawText } from './TextBox';
import { pointInRect } from '../utils';
import { drawBox, drawDivider, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';

// Layout constants
const SLOT_SIZE = 54;
const SLOT_GAP = 4;
const COLS = 4;
const ROWS_PER_PAGE = 4; // 4×4 = 16 slots per page
const PANEL_PAD = 12;
const HEADER_H = 40;
const NAV_H = 28;

const HOTBAR_SLOT_SIZE = 52;
const HOTBAR_GAP = 4;
const HOTBAR_BOTTOM_MARGIN = 12;

// Toggle button dimensions
const DESKTOP_BTN_W = 104;
const RIGHT_COL_MARGIN = 8;
const PAUSE_BTN_H = 28;
const TOGGLE_BTN_H = 28;
const BTN_ROW_GAP = 6;
const PANEL_TOP_MARGIN = 20;

// Hotbar hit margin
const HOTBAR_HIT_MARGIN = 12;

// Context menu layout
const CONTEXT_MENU_W = 120;
const CONTEXT_MENU_ITEM_H = 22;
const CONTEXT_MENU_V_PAD = 4;
const CONTEXT_MENU_MARGIN = 4;
const CONTEXT_LABEL_OFFSET = 6;

// Info popup
const INFO_POPUP_MAX_W = 280;
const INFO_POPUP_MARGIN = 32;
const INFO_POPUP_LINE_H = 15;
const INFO_POPUP_PAD = 10;
const INFO_POPUP_DESC_CHARS_PER_LINE = 36;
const INFO_TITLE_BOTTOM_OFFSET = 3;
const INFO_DIVIDER_OFFSET_X = 4;
const INFO_DIVIDER_MARGIN_X = 8;
const INFO_LABEL_X_OFFSET = 8;

// Drop dialog
const DROP_DIALOG_MAX_W = 200;
const DROP_DIALOG_MARGIN = 32;
const DROP_DIALOG_H = 110;
const DROP_TITLE_Y = 22;
const DROP_TITLE_Y_CORRECTION = 9;
const DROP_TITLE_SIZE = 11;
const DROP_CLOSE_BTN_OFFSET_X = 22;
const DROP_CLOSE_BTN_Y = 6;
const DROP_CLOSE_BTN_W = 16;
const DROP_CLOSE_BTN_H = 16;
const DROP_MINUS_BTN_X_PAD = 20;
const DROP_MINUS_BTN_Y = 54;
const DROP_PM_BTN_SIZE = 24;
const DROP_PLUS_BTN_OFFSET = 44;
const DROP_QTY_FONT_SIZE = 16;
const DROP_HINT_X_OFFSET = 14;
const DROP_QTY_Y_OFFSET = 5;
const DROP_HINT_Y_OFFSET = 11;
const DROP_HINT_SIZE = 9;
const DROP_CONFIRM_OFFSET = 28;
const DROP_CONFIRM_BTN_H = 22;
const DROP_CONFIRM_SIDE_PAD = 40;

// Panel header
const PANEL_HEADER_COINS_OFFSET = 36;
const PANEL_CLOSE_OFFSET_X = 20;
const PANEL_CLOSE_Y = 8;

// Hotbar strip padding
const HOTBAR_STRIP_PAD = 6;
const HOTBAR_STRIP_EXTRA_H = 18;

// Slot label
const SLOT_LABEL_BELOW_OFFSET = 4;
const SLOT_LABEL_SIZE = 9;

// Slot equipped badge
const SLOT_BADGE_LETTER_OPACITY = 0.55;

// Drag icon opacity
const DRAG_ICON_ALPHA = 0.75;

// Default minimap size when not yet updated by scene
const DEFAULT_MM_SIZE = 240;

// Info popup text offsets
const INFO_POPUP_PAD_HALF = 0.5;
const INFO_POPUP_PAD_TIMES_1_5 = 1.5;
const INFO_POPUP_DESC_BASELINE_OFFSET = 3;
const INFO_POPUP_DESC_BASELINE_CORRECTION = 8;
const INFO_POPUP_TITLE_CORRECTION = 9;
const INFO_POPUP_HINT_BOTTOM = 4;
const INFO_POPUP_HINT_CORRECTION = 7;
const INFO_POPUP_HINT_SIZE = 9;
const INFO_POPUP_TITLE_SIZE = 11;
const INFO_POPUP_DESC_SIZE = 10;

// Navagation bar
const NAV_BAR_LEFT_QUARTER = 0.25;
const NAV_BAR_RIGHT_QUARTER = 0.75;
const NAV_BAR_SIZE = 11;

// Panel header y-offsets
const PANEL_NAME_Y = 15;
const PANEL_COINS_Y = 16;

// Cooldown seconds threshold
const COOLDOWN_SECS_OVERFLOW = 99;

// Quantity badge minimum font
const QTY_BADGE_MIN_FONT = 7;
const QTY_BADGE_FONT_SCALE = 0.22;
const QTY_BADGE_MARGIN = 3;

// Close/back button in panel header
const CLOSE_BTN_W = 16;
const CLOSE_BTN_H = 16;

// Panel header text sizes
const PANEL_HEADER_NAME_SIZE = 12;
const PANEL_HEADER_COINS_SIZE = 11;

// Nav bar layout
const NAV_Y_ADJUST = 6;
const NAV_BASELINE_CORRECTION = 9;

// Cooldown
const COOLDOWN_PER_SECOND = 60;

// Health potion icon proportions
const HP_POTION_CX = 0.5;
const HP_POTION_CY = 0.58;
const HP_POTION_R = 0.27;
const HP_POTION_LIQUID_OFFSET = 0.15;
const HP_POTION_LIQUID_SCALE = 0.78;
const HP_POTION_NECK_X = 0.08;
const HP_POTION_NECK_Y = 0.22;
const HP_POTION_NECK_W = 0.16;
const HP_POTION_NECK_H = 0.2;
const HP_POTION_CORK_X = 0.1;
const HP_POTION_CORK_Y = 0.17;
const HP_POTION_CORK_W = 0.2;
const HP_POTION_CORK_H = 0.08;
const HP_POTION_SHINE_OFFSET = 0.3;
const HP_POTION_SHINE_RX = 0.22;
const HP_POTION_SHINE_RY = 0.13;
const HP_POTION_SHINE_ROT = -0.7;

// Scroll of confusing fog icon proportions
const SCROLL_CX = 0.5;
const SCROLL_CY = 0.55;
const SCROLL_W = 0.52;
const SCROLL_H = 0.42;
const SCROLL_ROLL_OFFSET = 3;
const SCROLL_ROLL_PAD = 2;
const SCROLL_ROLL_H = 6;
const SCROLL_ROLL_BOTTOM = 4;
const SCROLL_SQUIGGLE_ROWS = 3;
const SCROLL_SQUIGGLE_START_Y = 8;
const SCROLL_SQUIGGLE_ROW_H = 9;
const SCROLL_SQUIGGLE_AMP = 4;
const SCROLL_SQUIGGLE_INNER = 0.35;
const SCROLL_SQUIGGLE_CTRL = 0.1;
const SCROLL_GLOW_W = 0.45;
const SCROLL_GLOW_H = 0.35;

// Boxers icon proportions
const BOXERS_CX = 0.5;
const BOXERS_CY = 0.56;
const BOXERS_WAIST_X = 0.12;
const BOXERS_WAIST_Y = 0.22;
const BOXERS_WAIST_W = 0.76;
const BOXERS_WAIST_H = 0.18;
const BOXERS_LEG_INNER_X = 0.32;
const BOXERS_LEG_INNER_VERT = 0.38;
const BOXERS_LEG_OUTER_X = 0.38;
const BOXERS_LEG_BOTTOM = 0.72;
const BOXERS_LEG_CENTER = 0.05;
const BOXERS_HEART_FONT = 0.18;
const BOXERS_HEART_OFFSET = 0.16;
const BOXERS_HEART_Y_OFFSET = 0.08;

// Trollskin shirt icon proportions
const SHIRT_CX = 0.5;
const SHIRT_CY = 0.52;
const SHIRT_BODY_X = 0.3;
const SHIRT_BODY_TOP = 0.14;
const SHIRT_BODY_SIDE = 0.28;
const SHIRT_BODY_BOTTOM = 0.28;
const SHIRT_SLEEVE_X1 = 0.3;
const SHIRT_SLEEVE_X2 = 0.42;
const SHIRT_SLEEVE_X3 = 0.32;
const SHIRT_SLEEVE_X4 = 0.26;
const SHIRT_SLEEVE_Y_TOP = 0.14;
const SHIRT_SLEEVE_Y1 = 0.04;
const SHIRT_SLEEVE_Y2 = 0.08;
const SHIRT_SLEEVE_Y3 = 0.02;
const SHIRT_COLLAR_RX = 0.1;
const SHIRT_COLLAR_RY = 0.06;
const SHIRT_COLLAR_Y = 0.16;
const SHIRT_RUNE_FONT = 0.22;
const SHIRT_RUNE_Y = 0.14;

// Crown icon proportions
const CROWN_CX = 0.5;
const CROWN_CY = 0.48;
const CROWN_BASE_Y = 0.08;
const CROWN_BASE_RX = 0.34;
const CROWN_BASE_RY = 0.1;
const CROWN_BODY_X1 = 0.32;
const CROWN_BODY_Y1 = 0.04;
const CROWN_INNER_X1 = 0.28;
const CROWN_INNER_Y1 = 0.18;
const CROWN_INNER_X2 = 0.14;
const CROWN_INNER_Y2 = 0.06;
const CROWN_TIP_Y = 0.24;
const CROWN_GEM_CENTER_Y = 0.16;
const CROWN_GEM_CENTER_R = 0.06;
const CROWN_GEM_SIDE_X = 0.2;
const CROWN_GEM_SIDE_Y = 0.08;
const CROWN_GEM_SIDE_R = 0.04;

// Shared potion flask liquid-fill proportions
const POTION_LIQUID_Y_SHIFT = 0.15;
const POTION_LIQUID_R_SCALE = 0.78;
const POTION_SHINE_ALPHA = 0.4;

// Jugg Juice wide-flask uses an ellipse; needs its own RX scale
const JUGG_LIQUID_RX_SCALE = 0.82;

// Lightning bolt polygon geometry (fractions of bolt base size bs)
const BOLT_TIP_Y = 1.8;
const BOLT_NOTCH_X = 0.3;
const BOLT_NOTCH_Y = 0.1;
const BOLT_INNER_X = 0.5;

// Heart bezier geometry (fractions of heart size hs)
const HEART_APEX_Y = 0.3;
const HEART_TOP_CTRL = 0.3;
const HEART_MID_Y = 0.5;
const HEART_BOTTOM = 1.1;

// Clock hour hand angle: π/6 = 30° puts the short hand at 2 o'clock
const CLOCK_HOUR_ANGLE_DIVS = 6;

// Star centre Y shift (fraction of flask radius r)
const STAR_CY_SHIFT = 0.05;

// Shared geometry for round-flask potions (speed_fizz, cooldown_crisp, stat_boost)
const FLASK_CX = 0.5;
const FLASK_R = 0.25;
const FLASK_NECK_X = 0.07;
const FLASK_NECK_W = 0.14;
const FLASK_NECK_H = 0.18;
const FLASK_CORK_X = 0.09;
const FLASK_CORK_W = 0.18;
const FLASK_CORK_H = 0.08;
const FLASK_SHINE_OFFSET = 0.28;
const FLASK_SHINE_RX = 0.2;
const FLASK_SHINE_RY = 0.11;
const FLASK_SHINE_ROT = -0.7;

// Speed Fizz symbol geometry
const SPEED_FIZZ_BOLT_CX = 0.5;
const SPEED_FIZZ_BOLT_CY = 0.62;
const SPEED_FIZZ_BOLT_SCALE = 0.13;

// Jugg Juice flask geometry (wide ellipse — different from the round-flask defaults)
const JUGG_CY = 0.61;
const JUGG_RX = 0.3;
const JUGG_RY = 0.25;
const JUGG_NECK_X = 0.09;
const JUGG_NECK_Y = 0.26;
const JUGG_NECK_W = 0.18;
const JUGG_NECK_H = 0.14;
const JUGG_CORK_X = 0.11;
const JUGG_CORK_Y = 0.2;
const JUGG_CORK_W = 0.22;
const JUGG_HEART_SIZE = 0.12;
const JUGG_HEART_Y = 0.6;
const JUGG_SHINE_OFFSET = 0.25;

// Standard round-flask Y positions (speed_fizz and stat_boost share these)
const ROUND_FLASK_CY = 0.58;
const ROUND_FLASK_NECK_Y = 0.24;
const ROUND_FLASK_CORK_Y = 0.18;

// Cooldown Crisp clock symbol geometry — flask sits slightly higher to fit the clock face
const COOL_CRISP_CY = 0.55;
const COOL_CRISP_NECK_Y = 0.22;
const COOL_CRISP_CORK_Y = 0.16;
const COOL_CRISP_CLOCK_R = 0.14;
const COOL_CRISP_HAND_LONG = 0.11;
const COOL_CRISP_HAND_SHORT = 0.07;

// Stat Boost Potion star symbol geometry
const STAT_BOOST_STAR_R_OUTER = 0.17;
const STAT_BOOST_STAR_R_INNER = 0.08;
const STAT_BOOST_STAR_POINTS = 5;

// Cooldown overlay opacity
const COOLDOWN_OVERLAY_ALPHA = 0.65;
const COOLDOWN_OVERLAY_DARK = 0.75;
const COOLDOWN_Y_OFFSET = 4;
const COOLDOWN_FONT_SCALE = 0.28;
const COOLDOWN_FONT_BASELINE = 0.8;

/** How many pages are needed for the full slot array. */
function pageCount(slotCount: number): number {
  return Math.max(1, Math.ceil(slotCount / SLOTS_PER_PAGE));
}

/**
 * Draws the shared parts of a round-flask potion icon: body circle, liquid fill,
 * neck rect, cork rect, and shine highlight. Returns the computed centre and radius
 * so the caller can draw the symbol inside.
 */
function drawRoundFlask(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cyFrac: number,
  neckYFrac: number,
  corkYFrac: number,
  bodyColor: string,
  liquidColor: string,
  neckColor: string,
  corkColor: string,
): { cx: number; cy: number; r: number } {
  const cx = x + size * FLASK_CX;
  const cy = y + size * cyFrac;
  const r = size * FLASK_R;

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = liquidColor;
  ctx.beginPath();
  ctx.arc(cx, cy + r * POTION_LIQUID_Y_SHIFT, r * POTION_LIQUID_R_SCALE, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = neckColor;
  ctx.fillRect(
    cx - size * FLASK_NECK_X,
    y + size * neckYFrac,
    size * FLASK_NECK_W,
    size * FLASK_NECK_H,
  );

  ctx.fillStyle = corkColor;
  ctx.fillRect(
    cx - size * FLASK_CORK_X,
    y + size * corkYFrac,
    size * FLASK_CORK_W,
    size * FLASK_CORK_H,
  );

  ctx.fillStyle = `rgba(255,255,255,${POTION_SHINE_ALPHA})`;
  ctx.beginPath();
  ctx.ellipse(
    cx - r * FLASK_SHINE_OFFSET,
    cy - r * FLASK_SHINE_OFFSET,
    r * FLASK_SHINE_RX,
    r * FLASK_SHINE_RY,
    FLASK_SHINE_ROT,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  return { cx, cy, r };
}

export class InventoryPanel {
  isOpen = false;
  private page = 0;

  /**
   * When set, the panel's close button becomes a "Back to Menu" button.
   * Clicking it calls this callback and clears the reference. Toggling the
   * panel closed via keyboard/button clears it without calling the callback.
   */
  returnToMenuCallback: (() => void) | null = null;

  /**
   * Called whenever the panel is closed without returning to a menu — i.e.
   * via toggle (keyboard / toolbar button) or plain close-X click.
   */
  onClose: (() => void) | null = null;

  /** Interaction handler — owns drag, context menu, and pending action state. */
  readonly interaction: InventoryInteraction;

  constructor(interaction: InventoryInteraction = new InventoryInteraction()) {
    this.interaction = interaction;
  }

  private get drag() {
    return this.interaction.drag;
  }
  private get contextMenu() {
    return this.interaction.contextMenu;
  }
  private get contextMenuHover() {
    return this.interaction.contextMenuHover;
  }
  private get dropDialog() {
    return this.interaction.dropDialog;
  }

  cancelDrag(): void {
    this.interaction.cancelDrag();
  }

  /**
   * Screen-space rects for every option in the currently open context menu, or null when
   * no context menu is open. Set by renderContextMenu each frame so the tutorial can read
   * authoritative positions without recomputing the layout independently.
   */
  contextMenuOptionRects: ReadonlyArray<{
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> | null = null;

  toggle(): void {
    if (this.isOpen) {
      this.isOpen = false;
      this.returnToMenuCallback = null;
      this.onClose?.();
    } else {
      this.isOpen = true;
    }
  }

  // Layout helpers

  /**
   * Current minimap rendered size — set by DungeonScene each frame before render/handleClick
   * so the bag button can be positioned below the pause button, which itself sits below the minimap.
   * Must match the DESKTOP_BTN_W / PAUSE_BTN_H constants in DungeonUIRenderer.ts.
   */
  mmSize = DEFAULT_MM_SIZE;

  toggleBtnRect(canvas: HTMLCanvasElement) {
    // On mobile the button is handled via touch.bagBtnRect in renderMobileButtons.
    // On desktop, sit below the pause button in the right column.
    return {
      x: canvas.width - RIGHT_COL_MARGIN - DESKTOP_BTN_W,
      y: RIGHT_COL_MARGIN + this.mmSize + PANEL_TOP_MARGIN + PAUSE_BTN_H + BTN_ROW_GAP,
      w: DESKTOP_BTN_W,
      h: TOGGLE_BTN_H,
    };
  }

  /**
   * Optional per-ability cooldown fractions (0=ready, 1=full cooldown).
   * Set by DungeonScene each frame to show cooldown overlays in hotbar.
   */
  abilityCooldowns = new Map<string, { current: number; max: number }>();

  /**
   * Returns the inventory slot index if (mx, my) is on an inventory slot in the
   * currently-visible page, or null otherwise. Used by DungeonScene for equip-on-click.
   */
  getClickedInventorySlot(
    mx: number,
    my: number,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): number | null {
    if (!this.isOpen) return null;
    const p = this.panelRect(canvas);
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (pointInRect(mx, my, r)) return slotIdx;
    }
    return null;
  }

  private panelRect(canvas: HTMLCanvasElement) {
    const innerW = COLS * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
    const innerH = ROWS_PER_PAGE * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
    const w = innerW + PANEL_PAD * 2;
    const h = HEADER_H + PANEL_PAD + innerH + PANEL_PAD + NAV_H;
    return {
      x: Math.floor((canvas.width - w) / 2),
      y: Math.floor((canvas.height - h) / 2),
      w,
      h,
    };
  }

  private computedHotbarSlotSize(canvas: HTMLCanvasElement): number {
    const margin = 20;
    const available = canvas.width - margin * 2 - HOTBAR_GAP * (HOTBAR_COUNT - 1);
    return Math.min(HOTBAR_SLOT_SIZE, Math.floor(available / HOTBAR_COUNT));
  }

  private hotbarRect(canvas: HTMLCanvasElement) {
    const s = this.computedHotbarSlotSize(canvas);
    const w = HOTBAR_COUNT * (s + HOTBAR_GAP) - HOTBAR_GAP;
    return {
      x: Math.floor((canvas.width - w) / 2),
      y: canvas.height - s - HOTBAR_BOTTOM_MARGIN,
      w,
      h: s,
      slotSize: s,
    };
  }

  /** Screen rect for a slot in the paginated grid. `i` is position on current page (0–15). */
  private invSlotRect(i: number, panel: { x: number; y: number }) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      x: panel.x + PANEL_PAD + col * (SLOT_SIZE + SLOT_GAP),
      y: panel.y + HEADER_H + PANEL_PAD + row * (SLOT_SIZE + SLOT_GAP),
      w: SLOT_SIZE,
      h: SLOT_SIZE,
    };
  }

  private hotbarSlotRect(i: number, canvas: HTMLCanvasElement) {
    const hb = this.hotbarRect(canvas);
    return {
      x: hb.x + i * (hb.slotSize + HOTBAR_GAP),
      y: hb.y,
      w: hb.slotSize,
      h: hb.slotSize,
    };
  }

  /** Returns hotbar slot index (0–7) if (mx, my) hits a slot, else -1. */
  getHotbarTappedIndex(mx: number, my: number, canvas: HTMLCanvasElement): number {
    const hb = this.hotbarRect(canvas);
    if (my < hb.y - HOTBAR_HIT_MARGIN || my > hb.y + hb.h + HOTBAR_HIT_MARGIN) return -1;
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      if (mx >= r.x && mx <= r.x + r.w) return i;
    }
    return -1;
  }

  /** True if (mx, my) is within the open inventory panel area. */
  hitsPanel(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this.isOpen) return false;
    const p = this.panelRect(canvas);
    return pointInRect(mx, my, p);
  }

  /** True while an item is being dragged. */
  get isDragging(): boolean {
    return this.drag !== null;
  }

  /**
   * Returns the screen rect of the given bag slot index if the inventory panel
   * is open and the slot is on the currently-visible page, otherwise null.
   */
  getBagSlotRect(
    slotIdx: number,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number; w: number; h: number } | null {
    if (!this.isOpen) return null;
    const pageStart = this.page * SLOTS_PER_PAGE;
    const pageEnd = pageStart + SLOTS_PER_PAGE;
    if (slotIdx < pageStart || slotIdx >= pageEnd) return null;
    const p = this.panelRect(canvas);
    return this.invSlotRect(slotIdx - pageStart, p);
  }

  /** Returns the screen rect of the given hotbar slot index. */
  getHotbarSlotRect(
    slotIdx: number,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number; w: number; h: number } {
    return this.hotbarSlotRect(slotIdx, canvas);
  }

  // Render

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
    coins: number,
  ): void {
    this.renderToggleButton(ctx, canvas);
    this.renderHotbar(ctx, canvas, inventory);
    if (this.isOpen) {
      this.renderPanel(ctx, canvas, inventory, playerName, coins);
    }
    // Dragged item floats on top of everything
    if (this.drag) {
      const s = SLOT_SIZE;
      this.renderItemIcon(
        ctx,
        this.drag.item,
        this.drag.mx - s / 2,
        this.drag.my - s / 2,
        s,
        DRAG_ICON_ALPHA,
      );
    }

    // Context menu and info popup render above everything else.
    // Reset each frame so contextMenuOptionRects is never stale.
    this.contextMenuOptionRects = null;
    if (this.contextMenu) {
      this.renderContextMenu(ctx, canvas);
    }
    if (this.interaction.pendingInfoItem) {
      this.renderInfoPopup(ctx, canvas, this.interaction.pendingInfoItem);
    }
    if (this.dropDialog) {
      this.renderDropDialog(ctx, canvas);
    }
  }

  private renderContextMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cm = this.contextMenu;
    if (!cm) return;
    const options = this.interaction.contextMenuOptions(cm.item, cm.source, cm.isEquipped);
    const menuW = CONTEXT_MENU_W;
    const menuItemH = CONTEXT_MENU_ITEM_H;
    const menuH = options.length * menuItemH + CONTEXT_MENU_V_PAD;
    const mx = Math.min(cm.x, canvas.width - menuW - CONTEXT_MENU_MARGIN);
    const my = Math.min(cm.y, canvas.height - menuH - CONTEXT_MENU_MARGIN);

    this.contextMenuOptionRects = options.map((label, i) => ({
      label,
      x: mx,
      y: my + 2 + i * menuItemH,
      w: menuW,
      h: menuItemH,
    }));

    ctx.save();
    drawBox(ctx, {
      x: mx,
      y: my,
      width: menuW,
      height: menuH,
      fill: 'rgba(10,14,30,0.97)',
      border: '#475569',
      borderWidth: 1,
    });

    for (let i = 0; i < options.length; i++) {
      const oy = my + 2 + i * menuItemH;
      if (this.contextMenuHover === i) {
        ctx.fillStyle = 'rgba(59,130,246,0.3)';
        ctx.fillRect(mx + 1, oy, menuW - 2, menuItemH);
      }
      const color =
        options[i] === 'Equip' ? '#4ade80' : options[i] === 'Unequip' ? '#f87171' : '#e2e8f0';
      // baseline_y=oy+15, size=11 → top_y = oy+15-9 = oy+6
      drawText(ctx, options[i], {
        x: mx + INFO_LABEL_X_OFFSET,
        y: oy + CONTEXT_LABEL_OFFSET,
        size: 11,
        color,
      });
    }
    ctx.restore();
  }

  private renderInfoPopup(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    item: InventoryItem,
  ): void {
    const popW = Math.min(INFO_POPUP_MAX_W, canvas.width - INFO_POPUP_MARGIN);
    const lineH = INFO_POPUP_LINE_H;
    const pad = INFO_POPUP_PAD;

    const descText = item.description ?? 'No description available.';

    // Estimate popup height: title line + divider space + description lines + hint
    // Use a rough line estimate for pre-draw sizing (similar to original)
    const approxDescLines = Math.ceil(descText.length / INFO_POPUP_DESC_CHARS_PER_LINE) || 1;
    const popH = pad + lineH + pad * INFO_POPUP_PAD_HALF + approxDescLines * lineH + pad;
    const px = Math.floor((canvas.width - popW) / 2);
    const py = Math.floor((canvas.height - popH) / 2);

    ctx.save();
    drawBox(ctx, {
      x: px,
      y: py,
      width: popW,
      height: popH,
      ...BOX_PRESETS.tooltip,
      borderWidth: 1.5,
    });

    // Title: baseline_y = py+pad+lineH-3, size=11 → top_y = baseline_y - 9
    drawText(ctx, item.name, {
      x: px + pad,
      y: py + pad + lineH - INFO_TITLE_BOTTOM_OFFSET - INFO_POPUP_TITLE_CORRECTION,
      bold: true,
      size: INFO_POPUP_TITLE_SIZE,
      color: '#e2e8f0',
    });

    // Divider
    drawDivider(ctx, {
      x: px + INFO_DIVIDER_OFFSET_X,
      y: py + pad + lineH + 2,
      length: popW - INFO_DIVIDER_MARGIN_X,
      color: '#1e293b',
    });

    // Description with built-in word-wrap
    // baseline_y = py+pad*1.5+lineH*2-3, size=10 → top_y = baseline_y - 8
    drawText(ctx, descText, {
      x: px + pad,
      y:
        py +
        pad * INFO_POPUP_PAD_TIMES_1_5 +
        lineH * 2 -
        INFO_POPUP_DESC_BASELINE_OFFSET -
        INFO_POPUP_DESC_BASELINE_CORRECTION,
      size: INFO_POPUP_DESC_SIZE,
      color: '#94a3b8',
      width: popW - pad * 2,
      lineHeight: lineH,
    });

    // Close hint: baseline_y = py+popH-4, size=9 → top_y = baseline_y - 7
    drawText(ctx, '[Click anywhere to close]', {
      x: px + popW / 2,
      y: py + popH - INFO_POPUP_HINT_BOTTOM - INFO_POPUP_HINT_CORRECTION,
      size: INFO_POPUP_HINT_SIZE,
      color: '#475569',
      align: 'center',
    });

    ctx.restore();
  }

  private renderDropDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const dd = this.dropDialog;
    if (!dd) return;
    const dlgW = Math.min(DROP_DIALOG_MAX_W, canvas.width - DROP_DIALOG_MARGIN);
    const dlgH = DROP_DIALOG_H;
    const dlgX = Math.floor((canvas.width - dlgW) / 2);
    const dlgY = Math.floor((canvas.height - dlgH) / 2);

    ctx.save();
    // Background
    drawBox(ctx, {
      x: dlgX,
      y: dlgY,
      width: dlgW,
      height: dlgH,
      fill: 'rgba(8,10,20,0.97)',
      border: '#475569',
      borderWidth: 1.5,
    });

    // Title: baseline_y=dlgY+22, size=11 → top_y = dlgY+22-9 = dlgY+13
    drawText(ctx, 'Drop how many?', {
      x: dlgX + dlgW / 2,
      y: dlgY + DROP_TITLE_Y - DROP_TITLE_Y_CORRECTION,
      size: DROP_TITLE_SIZE,
      bold: true,
      color: '#e2e8f0',
      align: 'center',
    });

    // Cancel [X]
    drawButton(ctx, {
      x: dlgX + dlgW - DROP_CLOSE_BTN_OFFSET_X,
      y: dlgY + DROP_CLOSE_BTN_Y,
      width: DROP_CLOSE_BTN_W,
      height: DROP_CLOSE_BTN_H,
      label: 'x',
      fill: '#374151',
      border: '#475569',
      borderWidth: 1,
      radius: 2,
      labelSize: 11,
      labelColor: '#ef4444',
    });

    // [-] button
    const minusBtnX = dlgX + DROP_MINUS_BTN_X_PAD;
    const minusBtnY = dlgY + DROP_MINUS_BTN_Y;
    drawButton(ctx, {
      x: minusBtnX,
      y: minusBtnY,
      width: DROP_PM_BTN_SIZE,
      height: DROP_PM_BTN_SIZE,
      label: '-',
      ...BUTTON_PRESETS.primary,
      border: '#475569',
      labelSize: 11,
    });

    // [+] button
    const plusBtnX = dlgX + dlgW - DROP_PLUS_BTN_OFFSET;
    drawButton(ctx, {
      x: plusBtnX,
      y: minusBtnY,
      width: DROP_PM_BTN_SIZE,
      height: DROP_PM_BTN_SIZE,
      label: '+',
      ...BUTTON_PRESETS.primary,
      border: '#475569',
      labelSize: 11,
    });

    // Quantity display: baseline_y=minusBtnY+18, size=16 → top_y = minusBtnY+18-13 = minusBtnY+5
    drawText(ctx, dd.selectedQty.toString(), {
      x: dlgX + dlgW / 2,
      y: minusBtnY + DROP_QTY_Y_OFFSET,
      size: DROP_QTY_FONT_SIZE,
      bold: true,
      color: '#fbbf24',
      align: 'center',
    });

    // Max hint: baseline_y=minusBtnY+18, size=9 → top_y = minusBtnY+18-7 = minusBtnY+11
    drawText(ctx, `/ ${dd.maxQty}`, {
      x: dlgX + dlgW / 2 + DROP_HINT_X_OFFSET,
      y: minusBtnY + DROP_HINT_Y_OFFSET,
      size: DROP_HINT_SIZE,
      color: '#64748b',
    });

    // [Drop] confirm button
    const confirmY = dlgY + dlgH - DROP_CONFIRM_OFFSET;
    drawButton(ctx, {
      x: dlgX + DROP_MINUS_BTN_X_PAD,
      y: confirmY,
      width: dlgW - DROP_CONFIRM_SIDE_PAD,
      height: DROP_CONFIRM_BTN_H,
      label: 'Drop',
      fill: '#1d4ed8',
      border: '#3b82f6',
      borderWidth: 1.5,
      radius: 4,
      labelSize: 11,
    });

    ctx.restore();
  }

  private renderToggleButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!platform.showDesktopToggleButtons) return;
    const btn = this.toggleBtnRect(canvas);
    drawButton(ctx, {
      x: btn.x,
      y: btn.y,
      width: btn.w,
      height: btn.h,
      label: 'Bag [I]',
      ...(this.isOpen ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
    });
  }

  private renderHotbar(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
  ): void {
    const hb = this.hotbarRect(canvas);
    // Background strip
    drawBox(ctx, {
      x: hb.x - HOTBAR_STRIP_PAD,
      y: hb.y - HOTBAR_STRIP_PAD,
      width: hb.w + HOTBAR_STRIP_PAD * 2,
      height: hb.h + HOTBAR_STRIP_EXTRA_H,
      fill: 'rgba(0,0,0,0.65)',
    });

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i, canvas);
      const isDragged = this.drag?.source === 'hotbar' && this.drag.idx === i;
      const hotbarItem = inventory.actionBar.slots[i];
      this.renderSlot(
        ctx,
        r.x,
        r.y,
        r.w,
        hotbarItem,
        isDragged,
        true,
        hotbarItem !== null && inventory.hasEquipped(hotbarItem.id),
      );

      // Separator line before quest slot
      if (i === QUEST_SLOT_IDX) {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x - 2, r.y + 2);
        ctx.lineTo(r.x - 2, r.y + r.h - 2);
        ctx.stroke();
      }

      // Key label below slot — "Q" for quest slot, number for the rest
      const keyLabel = i === QUEST_SLOT_IDX ? 'Q' : (i + 1).toString();
      const keyColor = i === QUEST_SLOT_IDX ? '#fbbf24' : '#64748b';
      // baseline_y = r.y+r.h+11, size=9 → top_y = baseline_y - 7 = r.y+r.h+4
      drawText(ctx, keyLabel, {
        x: r.x + r.w / 2,
        y: r.y + r.h + SLOT_LABEL_BELOW_OFFSET,
        size: SLOT_LABEL_SIZE,
        color: keyColor,
        align: 'center',
      });
    }
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    inventory: Inventory,
    playerName: string,
    coins: number,
  ): void {
    const p = this.panelRect(canvas);

    // Backdrop
    drawBox(ctx, {
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      fill: 'rgba(8,10,20,0.93)',
      border: '#334155',
      borderWidth: 1.5,
    });

    // Header — player name: baseline_y=p.y+25, size=12 → top_y = p.y+25-10 = p.y+15
    drawText(ctx, `${playerName} Inventory`, {
      x: p.x + PANEL_PAD,
      y: p.y + PANEL_NAME_Y,
      bold: true,
      size: PANEL_HEADER_NAME_SIZE,
      color: '#e2e8f0',
    });

    // Coins: baseline_y=p.y+25, size=11 → top_y = p.y+25-9 = p.y+16
    drawText(ctx, `\u{1FA99} ${coins}`, {
      x: p.x + p.w - PANEL_HEADER_COINS_OFFSET,
      y: p.y + PANEL_COINS_Y,
      size: PANEL_HEADER_COINS_SIZE,
      color: '#fbbf24',
      align: 'right',
    });

    // Close / Back button — always in the top-right corner
    const closeX = p.x + p.w - PANEL_CLOSE_OFFSET_X;
    const closeY = p.y + PANEL_CLOSE_Y;
    if (this.returnToMenuCallback !== null) {
      drawButton(ctx, {
        x: closeX,
        y: closeY,
        width: CLOSE_BTN_W,
        height: CLOSE_BTN_H,
        label: '←',
        fill: '#1e3a5f',
        border: '#3b82f6',
        borderWidth: 1,
        radius: 2,
        labelSize: 11,
        labelColor: '#93c5fd',
      });
    } else {
      drawButton(ctx, {
        x: closeX,
        y: closeY,
        width: CLOSE_BTN_W,
        height: CLOSE_BTN_H,
        label: 'x',
        fill: '#374151',
        border: '#475569',
        borderWidth: 1,
        radius: 2,
        labelSize: 11,
        labelColor: '#ef4444',
      });
    }

    // Divider
    drawDivider(ctx, {
      x: p.x + INFO_DIVIDER_OFFSET_X,
      y: p.y + HEADER_H,
      length: p.w - INFO_DIVIDER_MARGIN_X,
      color: '#1e293b',
    });

    // Inventory slots
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      const item = slotIdx < inventory.bag.slots.length ? inventory.bag.slots[slotIdx] : null;
      const isDragged = this.drag?.source === 'inv' && this.drag.idx === slotIdx;
      const r = this.invSlotRect(i, p);
      this.renderSlot(
        ctx,
        r.x,
        r.y,
        r.w,
        item,
        isDragged,
        false,
        inventory.isSlotEquipped(slotIdx),
      );
    }

    // Pagination bar
    const pages = pageCount(inventory.bag.slots.length);
    const navY = p.y + p.h - NAV_H + NAV_Y_ADJUST;
    // baseline_y=navY, size=11 → top_y = navY - 9
    const navTopY = navY - NAV_BASELINE_CORRECTION;
    if (pages > 1) {
      // Prev arrow
      drawText(ctx, '< Prev', {
        x: p.x + p.w * NAV_BAR_LEFT_QUARTER,
        y: navTopY,
        size: NAV_BAR_SIZE,
        color: this.page > 0 ? '#94a3b8' : '#374151',
        align: 'center',
      });
      // Next arrow
      drawText(ctx, 'Next >', {
        x: p.x + p.w * NAV_BAR_RIGHT_QUARTER,
        y: navTopY,
        size: NAV_BAR_SIZE,
        color: this.page < pages - 1 ? '#94a3b8' : '#374151',
        align: 'center',
      });
    }
    drawText(ctx, `${this.page + 1} / ${pages}`, {
      x: p.x + p.w / 2,
      y: navTopY,
      size: NAV_BAR_SIZE,
      color: '#64748b',
      align: 'center',
    });
  }

  private renderSlot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    item: InventoryItem | null,
    dimmed: boolean,
    isHotbar: boolean,
    isEquipped = false,
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.25;

    const isQuestItem = isHotbar && item?.isQuestItem;
    ctx.fillStyle = isQuestItem ? '#1a2940' : isHotbar ? '#0f172a' : '#1e293b';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = isQuestItem
      ? '#fbbf24'
      : isEquipped
        ? '#3b82f6'
        : isHotbar
          ? '#475569'
          : '#334155';
    ctx.lineWidth = isEquipped ? 2 : 1;
    ctx.strokeRect(x, y, size, size);

    if (item && !dimmed) {
      this.renderItemIcon(ctx, item, x, y, size, 1);
    } else if (item && dimmed) {
      ctx.globalAlpha = 0.25;
      this.renderItemIcon(ctx, item, x, y, size, 1);
    }

    // Equipped icon badge (top-left corner)
    if (isEquipped && item && !dimmed) {
      ctx.save();
      ctx.globalAlpha = 1;
      const BADGE_SIZE_FRACTION = 0.3;
      const badgeSize = Math.floor(size * BADGE_SIZE_FRACTION);
      const bx = x + 1;
      const by = y + 1;
      // Green badge background
      ctx.fillStyle = 'rgba(16,185,129,0.9)';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + badgeSize, by);
      ctx.lineTo(bx, by + badgeSize);
      ctx.closePath();
      ctx.fill();
      // White "E" letter — original used textBaseline='top' so y=by+1 is already the top
      drawText(ctx, 'E', {
        x: bx + 1,
        y: by + 1,
        size: Math.floor(badgeSize * SLOT_BADGE_LETTER_OPACITY),
        bold: true,
        color: '#fff',
        align: 'left',
      });
      ctx.restore();
    }

    // Ability cooldown overlay on hotbar
    if (isHotbar && item?.abilityId) {
      const cd = this.abilityCooldowns.get(item.abilityId);
      if (cd && cd.current > 0) {
        const frac = cd.current / cd.max;
        ctx.globalAlpha = COOLDOWN_OVERLAY_ALPHA;
        ctx.fillStyle = `rgba(0,0,0,${COOLDOWN_OVERLAY_DARK})`;
        ctx.fillRect(x, y + size * (1 - frac), size, size * frac);
        ctx.globalAlpha = 1;
        // Remaining seconds
        const secs = Math.ceil(cd.current / COOLDOWN_PER_SECOND);
        const cdFontSize = Math.floor(size * COOLDOWN_FONT_SCALE);
        // baseline_y = y+size/2+4, cdFontSize → top_y = baseline_y - Math.round(cdFontSize*0.8)
        const cdTopY =
          y + size / 2 + COOLDOWN_Y_OFFSET - Math.round(cdFontSize * COOLDOWN_FONT_BASELINE);
        drawText(ctx, secs > COOLDOWN_SECS_OVERFLOW ? '…' : `${secs}`, {
          x: x + size / 2,
          y: cdTopY,
          size: cdFontSize,
          bold: true,
          color: '#e2e8f0',
          align: 'center',
        });
      }
    }

    ctx.restore();
  }

  private renderItemIcon(
    ctx: CanvasRenderingContext2D,
    item: InventoryItem,
    x: number,
    y: number,
    size: number,
    alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alpha;

    if (item.id === 'health_potion') {
      const cx = x + size * HP_POTION_CX;
      const cy = y + size * HP_POTION_CY;
      const r = size * HP_POTION_R;
      // Flask body
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Liquid fill
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy + r * HP_POTION_LIQUID_OFFSET, r * HP_POTION_LIQUID_SCALE, 0, Math.PI * 2);
      ctx.fill();
      // Flask neck
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(
        cx - size * HP_POTION_NECK_X,
        y + size * HP_POTION_NECK_Y,
        size * HP_POTION_NECK_W,
        size * HP_POTION_NECK_H,
      );
      // Cork stopper
      ctx.fillStyle = '#92400e';
      ctx.fillRect(
        cx - size * HP_POTION_CORK_X,
        y + size * HP_POTION_CORK_Y,
        size * HP_POTION_CORK_W,
        size * HP_POTION_CORK_H,
      );
      // Shine highlight
      const SHINE_ALPHA = 0.45;
      ctx.fillStyle = `rgba(255,255,255,${SHINE_ALPHA})`;
      ctx.beginPath();
      ctx.ellipse(
        cx - r * HP_POTION_SHINE_OFFSET,
        cy - r * HP_POTION_SHINE_OFFSET,
        r * HP_POTION_SHINE_RX,
        r * HP_POTION_SHINE_RY,
        HP_POTION_SHINE_ROT,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    if (item.id === 'scroll_of_confusing_fog') {
      const cx = x + size * SCROLL_CX;
      const cy = y + size * SCROLL_CY;
      const sw = size * SCROLL_W;
      const sh = size * SCROLL_H;
      // Parchment body
      ctx.fillStyle = '#d4b483';
      ctx.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);
      // Rolled top and bottom edges
      ctx.fillStyle = '#c49a40';
      ctx.fillRect(
        cx - sw / 2 - SCROLL_ROLL_OFFSET,
        cy - sh / 2 - SCROLL_ROLL_PAD,
        sw + SCROLL_ROLL_H,
        SCROLL_ROLL_H,
      );
      ctx.fillRect(
        cx - sw / 2 - SCROLL_ROLL_OFFSET,
        cy + sh / 2 - SCROLL_ROLL_BOTTOM,
        sw + SCROLL_ROLL_H,
        SCROLL_ROLL_H,
      );
      // Fog squiggle lines
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let row = 0; row < SCROLL_SQUIGGLE_ROWS; row++) {
        const ly = cy - sh / 2 + SCROLL_SQUIGGLE_START_Y + row * SCROLL_SQUIGGLE_ROW_H;
        ctx.moveTo(cx - sw * SCROLL_SQUIGGLE_INNER, ly);
        ctx.bezierCurveTo(
          cx - sw * SCROLL_SQUIGGLE_CTRL,
          ly - SCROLL_SQUIGGLE_AMP,
          cx + sw * SCROLL_SQUIGGLE_CTRL,
          ly + SCROLL_SQUIGGLE_AMP,
          cx + sw * SCROLL_SQUIGGLE_INNER,
          ly,
        );
      }
      ctx.stroke();
      // Green fog tint glow
      const SCROLL_GLOW_ALPHA = 0.28;
      ctx.fillStyle = `rgba(60,200,140,${SCROLL_GLOW_ALPHA})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, sw * SCROLL_GLOW_W, sh * SCROLL_GLOW_H, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (item.id === 'magic_missile_tome') {
      drawSpriteKey(ctx, 'magic_missile_icon', 'standard', 0, x, y, size);
    }

    if (item.id === 'smush_tome') {
      drawSpriteKey(ctx, 'smush_icon', 'standard', 0, x, y, size);
    }

    if (item.id === 'enchanted_bigboi_boxers') {
      const cx = x + size * BOXERS_CX;
      const cy = y + size * BOXERS_CY;
      // Waistband — white/light grey
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(
        x + size * BOXERS_WAIST_X,
        y + size * BOXERS_WAIST_Y,
        size * BOXERS_WAIST_W,
        size * BOXERS_WAIST_H,
      );
      // Left leg — near-white
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.moveTo(cx - size * BOXERS_LEG_INNER_X, y + size * BOXERS_LEG_INNER_VERT);
      ctx.lineTo(cx - size * BOXERS_LEG_OUTER_X, y + size * BOXERS_LEG_BOTTOM);
      ctx.lineTo(cx - size * BOXERS_LEG_CENTER, y + size * BOXERS_LEG_BOTTOM);
      ctx.lineTo(cx, y + size * BOXERS_LEG_INNER_VERT);
      ctx.closePath();
      ctx.fill();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(cx + size * BOXERS_LEG_INNER_X, y + size * BOXERS_LEG_INNER_VERT);
      ctx.lineTo(cx + size * BOXERS_LEG_OUTER_X, y + size * BOXERS_LEG_BOTTOM);
      ctx.lineTo(cx + size * BOXERS_LEG_CENTER, y + size * BOXERS_LEG_BOTTOM);
      ctx.lineTo(cx, y + size * BOXERS_LEG_INNER_VERT);
      ctx.closePath();
      ctx.fill();
      // Red hearts pattern — sprite icon text, leave as ctx.fillText
      ctx.fillStyle = '#ef4444';
      ctx.font = `bold ${Math.floor(size * BOXERS_HEART_FONT)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('♥', cx - size * BOXERS_HEART_OFFSET, cy - size * BOXERS_HEART_Y_OFFSET);
      ctx.fillText('♥', cx + size * BOXERS_HEART_OFFSET, cy - size * BOXERS_HEART_Y_OFFSET);
      ctx.fillText('♥', cx, cy + size * BOXERS_HEART_Y_OFFSET);
      ctx.textAlign = 'left';
      // Red border glow
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'trollskin_shirt') {
      const cx = x + size * SHIRT_CX;
      const cy = y + size * SHIRT_CY;
      // Shirt body — mossy green (trollskin)
      ctx.fillStyle = '#4a7c59';
      ctx.beginPath();
      ctx.moveTo(cx - size * SHIRT_BODY_X, cy - size * SHIRT_BODY_TOP);
      ctx.lineTo(cx + size * SHIRT_BODY_X, cy - size * SHIRT_BODY_TOP);
      ctx.lineTo(cx + size * SHIRT_BODY_SIDE, cy + size * SHIRT_BODY_BOTTOM);
      ctx.lineTo(cx - size * SHIRT_BODY_SIDE, cy + size * SHIRT_BODY_BOTTOM);
      ctx.closePath();
      ctx.fill();
      // Sleeves
      ctx.fillStyle = '#3d6b4a';
      // Left sleeve
      ctx.beginPath();
      ctx.moveTo(cx - size * SHIRT_SLEEVE_X1, cy - size * SHIRT_SLEEVE_Y_TOP);
      ctx.lineTo(cx - size * SHIRT_SLEEVE_X2, cy + size * SHIRT_SLEEVE_Y1);
      ctx.lineTo(cx - size * SHIRT_SLEEVE_X3, cy + size * SHIRT_SLEEVE_Y2);
      ctx.lineTo(cx - size * SHIRT_SLEEVE_X4, cy - size * SHIRT_SLEEVE_Y3);
      ctx.closePath();
      ctx.fill();
      // Right sleeve
      ctx.beginPath();
      ctx.moveTo(cx + size * SHIRT_SLEEVE_X1, cy - size * SHIRT_SLEEVE_Y_TOP);
      ctx.lineTo(cx + size * SHIRT_SLEEVE_X2, cy + size * SHIRT_SLEEVE_Y1);
      ctx.lineTo(cx + size * SHIRT_SLEEVE_X3, cy + size * SHIRT_SLEEVE_Y2);
      ctx.lineTo(cx + size * SHIRT_SLEEVE_X4, cy - size * SHIRT_SLEEVE_Y3);
      ctx.closePath();
      ctx.fill();
      // Collar
      ctx.fillStyle = '#2d5a3a';
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy - size * SHIRT_COLLAR_Y,
        size * SHIRT_COLLAR_RX,
        size * SHIRT_COLLAR_RY,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Enchantment rune — golden fist symbol (sprite icon text, leave as ctx.fillText)
      ctx.fillStyle = '#ffd700';
      ctx.font = `bold ${Math.floor(size * SHIRT_RUNE_FONT)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('\u{270A}', cx, cy + size * SHIRT_RUNE_Y);
      ctx.textAlign = 'left';
      // Golden border glow
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'enchanted_crown_sepsis_whore') {
      const cx = x + size * CROWN_CX;
      const cy = y + size * CROWN_CY;
      // Crown base band — deep purple
      ctx.fillStyle = '#581c87';
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy + size * CROWN_BASE_Y,
        size * CROWN_BASE_RX,
        size * CROWN_BASE_RY,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Crown body — royal purple
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.moveTo(cx - size * CROWN_BODY_X1, cy + size * CROWN_BODY_Y1);
      ctx.lineTo(cx - size * CROWN_INNER_X1, cy - size * CROWN_INNER_Y1);
      ctx.lineTo(cx - size * CROWN_INNER_X2, cy - size * CROWN_INNER_Y2);
      ctx.lineTo(cx, cy - size * CROWN_TIP_Y);
      ctx.lineTo(cx + size * CROWN_INNER_X2, cy - size * CROWN_INNER_Y2);
      ctx.lineTo(cx + size * CROWN_INNER_X1, cy - size * CROWN_INNER_Y1);
      ctx.lineTo(cx + size * CROWN_BODY_X1, cy + size * CROWN_BODY_Y1);
      ctx.closePath();
      ctx.fill();
      // Crown rim highlight
      const CROWN_RIM_LINE_W = 1.5;
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = CROWN_RIM_LINE_W;
      ctx.stroke();
      // Gems — sickly green (sepsis theme)
      ctx.fillStyle = '#bef264';
      ctx.shadowColor = '#65a30d';
      const CROWN_GEM_BLUR = 4;
      ctx.shadowBlur = CROWN_GEM_BLUR;
      ctx.beginPath();
      ctx.arc(cx, cy - size * CROWN_GEM_CENTER_Y, size * CROWN_GEM_CENTER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(
        cx - size * CROWN_GEM_SIDE_X,
        cy - size * CROWN_GEM_SIDE_Y,
        size * CROWN_GEM_SIDE_R,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        cx + size * CROWN_GEM_SIDE_X,
        cy - size * CROWN_GEM_SIDE_Y,
        size * CROWN_GEM_SIDE_R,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.shadowBlur = 0;
      // Purple border glow
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    if (item.id === 'quest_wood_board') {
      drawWoodPileSprite(ctx, x, y, size, false);
    }

    if (item.id === 'speed_fizz') {
      drawRoundFlask(
        ctx,
        x,
        y,
        size,
        ROUND_FLASK_CY,
        ROUND_FLASK_NECK_Y,
        ROUND_FLASK_CORK_Y,
        '#0284c7',
        '#38bdf8',
        '#075985',
        '#92400e',
      );
      const bx = x + size * SPEED_FIZZ_BOLT_CX;
      const by = y + size * SPEED_FIZZ_BOLT_CY;
      const bs = size * SPEED_FIZZ_BOLT_SCALE;
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(bx + bs, by - bs * BOLT_TIP_Y);
      ctx.lineTo(bx - bs * BOLT_NOTCH_X, by - bs * BOLT_NOTCH_Y);
      ctx.lineTo(bx + bs * BOLT_INNER_X, by - bs * BOLT_NOTCH_Y);
      ctx.lineTo(bx - bs, by + bs * BOLT_TIP_Y);
      ctx.lineTo(bx + bs * BOLT_NOTCH_X, by + bs * BOLT_NOTCH_Y);
      ctx.lineTo(bx - bs * BOLT_INNER_X, by + bs * BOLT_NOTCH_Y);
      ctx.closePath();
      ctx.fill();
    }

    if (item.id === 'jugg_juice') {
      const cx = x + size * FLASK_CX;
      const cy = y + size * JUGG_CY;
      const rx = size * JUGG_RX;
      const ry = size * JUGG_RY;
      ctx.fillStyle = '#c2410c';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy + ry * POTION_LIQUID_Y_SHIFT,
        rx * JUGG_LIQUID_RX_SCALE,
        ry * POTION_LIQUID_R_SCALE,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(
        cx - size * JUGG_NECK_X,
        y + size * JUGG_NECK_Y,
        size * JUGG_NECK_W,
        size * JUGG_NECK_H,
      );
      ctx.fillStyle = '#92400e';
      ctx.fillRect(
        cx - size * JUGG_CORK_X,
        y + size * JUGG_CORK_Y,
        size * JUGG_CORK_W,
        size * FLASK_CORK_H,
      );
      const hx = cx;
      const hy = y + size * JUGG_HEART_Y;
      const hs = size * JUGG_HEART_SIZE;
      ctx.fillStyle = '#fda4af';
      ctx.beginPath();
      ctx.moveTo(hx, hy + hs * HEART_APEX_Y);
      ctx.bezierCurveTo(
        hx,
        hy - hs * HEART_TOP_CTRL,
        hx - hs,
        hy - hs * HEART_TOP_CTRL,
        hx - hs,
        hy,
      );
      ctx.bezierCurveTo(hx - hs, hy + hs * HEART_MID_Y, hx, hy + hs, hx, hy + hs * HEART_BOTTOM);
      ctx.bezierCurveTo(hx, hy + hs, hx + hs, hy + hs * HEART_MID_Y, hx + hs, hy);
      ctx.bezierCurveTo(
        hx + hs,
        hy - hs * HEART_TOP_CTRL,
        hx,
        hy - hs * HEART_TOP_CTRL,
        hx,
        hy + hs * HEART_APEX_Y,
      );
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${POTION_SHINE_ALPHA})`;
      ctx.beginPath();
      ctx.ellipse(
        cx - rx * JUGG_SHINE_OFFSET,
        cy - ry * JUGG_SHINE_OFFSET,
        rx * FLASK_SHINE_RX,
        ry * FLASK_SHINE_RY,
        FLASK_SHINE_ROT,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    if (item.id === 'cooldown_crisp') {
      const { cx, cy } = drawRoundFlask(
        ctx,
        x,
        y,
        size,
        COOL_CRISP_CY,
        COOL_CRISP_NECK_Y,
        COOL_CRISP_CORK_Y,
        '#059669',
        '#34d399',
        '#065f46',
        '#92400e',
      );
      const clockR = size * COOL_CRISP_CLOCK_R;
      ctx.fillStyle = '#d1fae5';
      ctx.beginPath();
      ctx.arc(cx, cy, clockR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1;
      ctx.stroke();
      const longR = size * COOL_CRISP_HAND_LONG;
      const shortR = size * COOL_CRISP_HAND_SHORT;
      ctx.strokeStyle = '#064e3b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(-Math.PI / 2) * longR, cy + Math.sin(-Math.PI / 2) * longR);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(Math.PI / CLOCK_HOUR_ANGLE_DIVS) * shortR,
        cy + Math.sin(Math.PI / CLOCK_HOUR_ANGLE_DIVS) * shortR,
      );
      ctx.stroke();
    }

    if (item.id === 'stat_boost_potion') {
      const { cx, cy, r } = drawRoundFlask(
        ctx,
        x,
        y,
        size,
        ROUND_FLASK_CY,
        ROUND_FLASK_NECK_Y,
        ROUND_FLASK_CORK_Y,
        '#7e22ce',
        '#c084fc',
        '#581c87',
        '#d97706',
      );
      const outerR = size * STAT_BOOST_STAR_R_OUTER;
      const innerR = size * STAT_BOOST_STAR_R_INNER;
      const starCY = cy + r * STAR_CY_SHIFT;
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      for (let i = 0; i < STAT_BOOST_STAR_POINTS * 2; i++) {
        const angle = (i * Math.PI) / STAT_BOOST_STAR_POINTS - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = cx + Math.cos(angle) * rad;
        const py = starCY + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    if (item.id === 'goblin_dynamite') {
      drawDynamiteInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_dumbbell') {
      drawDumbbellInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_bench_press') {
      drawBenchPressInventoryIcon(ctx, x, y, size);
    } else if (item.id === 'gym_treadmill') {
      drawTreadmillInventoryIcon(ctx, x, y, size);
    }

    // Quantity badge (bottom-right) — sprite icon text, leave as ctx.fillText
    // Uses textAlign='right' where x is the RIGHT edge; dynamic font size
    if (item.quantity > 1) {
      const fontSize = Math.max(QTY_BADGE_MIN_FONT, Math.floor(size * QTY_BADGE_FONT_SCALE));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(
        item.quantity.toString(),
        x + size - QTY_BADGE_MARGIN,
        y + size - QTY_BADGE_MARGIN,
      );
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  // Interaction

  handleClick(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): boolean {
    const p = this.panelRect(canvas);

    return this.interaction.handleClick(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      () => this.toggle(),
      this.toggleBtnRect(canvas),
      p,
      this.page,
      (pg) => {
        this.page = pg;
      },
      (o) => {
        if (!o) {
          if (this.returnToMenuCallback !== null) {
            const cb = this.returnToMenuCallback;
            this.returnToMenuCallback = null;
            cb();
          } else {
            this.isOpen = false;
            this.onClose?.();
          }
        } else {
          this.isOpen = true;
        }
      },
    );
  }

  handleMouseDown(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.handleMouseDown(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  openContextMenu(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.openContextMenu(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  handleMouseMove(mx: number, my: number): void {
    this.interaction.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number, canvas: HTMLCanvasElement, inventory: Inventory): void {
    this.interaction.handleMouseUp(
      mx,
      my,
      canvas,
      inventory,
      this.isOpen,
      (i, c) => this.hotbarSlotRect(i, c),
      this.panelRect(canvas),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }
}
