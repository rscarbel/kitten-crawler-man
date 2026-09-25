import type { Inventory } from '../core/Inventory';
import { type CoverPalette, drawBookIcon, drawSkillBookIcon } from './icons/skillBookIcon';
import { drawIssueKitIcon, isIssueKitItem } from './icons/issueKitIcon';
import { drawEnchantedGearIcon, isEnchantedGearItem } from './icons/enchantedGearIcons';
import { drawAnchorStoneIcon, drawAnchorShardIcon } from './icons/anchorStoneIcon';
import { drawResourceIcon, isResourceIconId } from './icons/resourceIcons';
import { drawToolIcon, isToolIconId } from './icons/toolIcons';
import { drawFoodIcon, isFoodIconId } from './icons/foodIcons';
import { drawKitIcon, isKitIconId } from './icons/kitIcons';
import {
  drawMagistratesWritIcon,
  drawUnreadableLetterIcon,
} from './icons/murderMysteryLetterIcons';
import {
  HOTBAR_COUNT,
  SLOTS_PER_PAGE,
  QUEST_SLOT_IDX,
  itemCanHotlist,
  isAnchorShardId,
} from '../core/ItemDefs';
import type { InventoryItem, ItemId } from '../core/ItemDefs';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { platform } from '../core/Platform';
import { keybindings } from '../core/Keybindings';
import { drawDynamiteInventoryIcon } from '../sprites/dynamiteSprite';
import {
  drawDumbbellInventoryIcon,
  drawBenchPressInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../sprites/gymEquipmentSprite';
import { drawWoodPileSprite } from '../sprites/questNPCSprite';
import { InventoryInteraction, CONTEXT_MENU_ITEM_HEIGHT } from './InventoryInteraction';
import { SearchField } from './SearchField';
import { drawCooldownOverlay } from './CooldownOverlay';
import { drawText, measureTextBox } from './TextBox';
import { pointInRect } from '../utils';
import { drawBox, drawDivider, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';
import { drawSatchelIcon } from './icons/satchelIcon';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// Layout constants
const MAX_SLOT_SIZE = 54;
/** Soot-black cover, charred-red spine: the explosives tome reads apart from every skill book. */
const EXPLOSIVES_TOME_COVER: CoverPalette = { cover: '#262222', spine: '#7f1d1d' };
/** The dynamite emblem on the tome's cover, as a share of the icon. */
const EXPLOSIVES_TOME_EMBLEM_SCALE = 0.55;
/** Nudges the emblem off the spine so it sits on the face of the cover. */
const EXPLOSIVES_TOME_EMBLEM_SPINE_OFFSET = 0.04;
const PANEL_SCREEN_MARGIN = 6;
const SLOT_GAP = 4;
const COLS = 4;
const ROWS_PER_PAGE = 4; // 4×4 = 16 slots per page
const PANEL_PAD = 12;
const NAV_H = 28;

// Header: a title/coins line, then the search field on its own line. The field
// gets the full inner width because the title line has none to spare — a bag
// four slots wide leaves under 40px between "Mordecai Inventory" and the coins.
const SEARCH_FIELD_Y = 30;
const SEARCH_FIELD_H = 20;
const SEARCH_FIELD_BOTTOM_PAD = 6;
const HEADER_H = SEARCH_FIELD_Y + SEARCH_FIELD_H + SEARCH_FIELD_BOTTOM_PAD;

const HOTBAR_SLOT_SIZE = 52;
const HOTBAR_GAP = 4;
const HOTBAR_BOTTOM_MARGIN = 12;
/** Clearance either side of the hotbar before its slots shrink to fit a narrow screen. */
const HOTBAR_SIDE_MARGIN = 20;

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
/** A context entry that exists but cannot be used right now, such as a summon still cooling down. */
const CONTEXT_DISABLED_COLOR = '#64748b';
const CONTEXT_MENU_V_PAD = 4;
const CONTEXT_LABEL_SIZE = 11;

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

// Panel header
const PANEL_HEADER_COINS_OFFSET = 36;
const PANEL_CLOSE_OFFSET_X = 20;
const PANEL_CLOSE_Y = 8;

// Hotbar strip padding
const HOTBAR_STRIP_PAD = 6;
const HOTBAR_STRIP_EXTRA_H = 18;

// Prohibition mark laid over every hotbar slot while un-hotlistable gear is dragged
const HOTBAR_DENY_RADIUS_FRACTION = 0.3;
const HOTBAR_DENY_COLOR = '#ef4444';
const HOTBAR_DENY_ALPHA = 0.8;
const HOTBAR_DENY_BAR_WIDTH = 4;
const RIGHT_ANGLE_RADIANS = Math.PI / 2;
/** The bar lies on the square slot's diagonal — half a right angle. */
const HOTBAR_DENY_BAR_ANGLE = RIGHT_ANGLE_RADIANS / 2;

// Slot label
const SLOT_LABEL_BELOW_OFFSET = 4;
const SLOT_LABEL_SIZE = 9;

// Slot equipped badge
const SLOT_BADGE_LETTER_OPACITY = 0.55;

// Drag icon opacity
const DRAG_ICON_ALPHA = 0.75;

// Bag button icon and unseen-upgrade badge
const TOGGLE_ICON_SIZE = 16;
const TOGGLE_ICON_PAD = 6;
const UNSEEN_BADGE_RADIUS = 5;
/** Peak scale of the bag button's landing squash-bounce. */
const BAG_BOUNCE_SCALE_AMOUNT = 0.18;
/** The "NEW" pip drawn on a bag slot holding an unseen upgrade. */
const NEW_PIP_RADIUS = 4;
const NEW_PIP_INSET = 4;
/** Clearance kept between the hovered item's name and the coins figure sharing the header strip. */
const PANEL_HEADER_COINS_TITLE_GAP = 6;

/**
 * What a slot fades to when it is not really available: the slot an item was
 * lifted out of, and — while the search field holds a query — a slot the query
 * does not match.
 */
const SLOT_DIMMED_ALPHA = 0.25;

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

// Quantity badge minimum font
const QTY_BADGE_MIN_FONT = 7;
const QTY_BADGE_FONT_SCALE = 0.22;
const QTY_BADGE_MARGIN = 3;
/** Thin outline — a full-weight one at this font size would swallow the digits. */
const QTY_BADGE_OUTLINE_WIDTH = 1.5;

// Close/back button in panel header
const CLOSE_BTN_W = 16;
const CLOSE_BTN_H = 16;

// Panel header text sizes
const PANEL_HEADER_NAME_SIZE = 12;
const PANEL_HEADER_COINS_SIZE = 11;

// Nav bar layout
const NAV_Y_ADJUST = 6;
const NAV_BASELINE_CORRECTION = 9;

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

// Doomsday Scenario: glass display case with a destabilizing soul crystal
const DOOMSDAY_CASE_INSET = 0.16;
const DOOMSDAY_CASE_TOP = 0.2;
const DOOMSDAY_CASE_BOTTOM = 0.9;
const DOOMSDAY_CRYSTAL_CX = 0.5;
const DOOMSDAY_CRYSTAL_CY = 0.56;
const DOOMSDAY_CRYSTAL_W = 0.16;
const DOOMSDAY_CRYSTAL_H = 0.3;
const DOOMSDAY_CRYSTAL_GLOW_BLUR = 5;

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

// Dirty Shirley icon proportions — a tall straight-sided highball glass, drawn as its
// own shape rather than via drawRoundFlask since a tumbler has no round body or neck
const DIRTY_SHIRLEY_CX = 0.5;
const DIRTY_SHIRLEY_GLASS_HALF_W = 0.2;
const DIRTY_SHIRLEY_GLASS_TOP_Y = 0.14;
const DIRTY_SHIRLEY_GLASS_BOTTOM_Y = 0.88;
const DIRTY_SHIRLEY_RIM_RY = 0.02;
const DIRTY_SHIRLEY_LIQUID_TOP_Y = 0.26;
const DIRTY_SHIRLEY_LIQUID_INSET = 0.02;
const DIRTY_SHIRLEY_HIGHLIGHT_X_OFFSET = 0.06;
const DIRTY_SHIRLEY_HIGHLIGHT_W = 0.045;
const DIRTY_SHIRLEY_HIGHLIGHT_ALPHA = 0.3;
const DIRTY_SHIRLEY_BUBBLE_R = 0.014;
const DIRTY_SHIRLEY_BUBBLE_1_X = 0.42;
const DIRTY_SHIRLEY_BUBBLE_1_Y = 0.7;
const DIRTY_SHIRLEY_BUBBLE_2_X = 0.58;
const DIRTY_SHIRLEY_BUBBLE_2_Y = 0.56;
const DIRTY_SHIRLEY_BUBBLE_3_X = 0.47;
const DIRTY_SHIRLEY_BUBBLE_3_Y = 0.42;
const DIRTY_SHIRLEY_CHERRY_X_OFFSET = 0.12;
const DIRTY_SHIRLEY_CHERRY_Y_OFFSET = -0.03;
const DIRTY_SHIRLEY_CHERRY_R = 0.055;
const DIRTY_SHIRLEY_CHERRY_SHINE_X_OFFSET = -0.018;
const DIRTY_SHIRLEY_CHERRY_SHINE_Y_OFFSET = -0.018;
const DIRTY_SHIRLEY_CHERRY_SHINE_R = 0.016;
const DIRTY_SHIRLEY_STEM_END_X_OFFSET = -0.03;
const DIRTY_SHIRLEY_STEM_END_Y_OFFSET = -0.1;
const DIRTY_SHIRLEY_STEM_CTRL_X_OFFSET = 0.05;
const DIRTY_SHIRLEY_STEM_CTRL_Y_OFFSET = -0.06;

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
  private _isOpen = false;
  private page = 0;
  /** Whether the panel was open on the previous frame — the edge that clears `unseenUpgrades`. */
  private _wasOpenLastFrame = false;
  /** The bag or hotbar item currently under the cursor, named in the header strip while hovered. */
  private hoveredItem: InventoryItem | null = null;

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

  /**
   * Notified right after the panel closes, once its own sub-menus (context
   * menu, description popup, drag, a queued quantity prompt) have already been
   * reset. A host that opened its own overlay in response to one of those
   * items — the shared quantity picker — wires this to close it too, so
   * nothing spawned from an item action can outlive the panel it was opened
   * from, whichever of the several routes actually closed it.
   */
  onClosingSubPanels: (() => void) | null = null;

  /** Interaction handler — owns drag, context menu, and pending action state. */
  readonly interaction: InventoryInteraction;

  /** Header filter. Dims non-matching slots rather than hiding them. */
  private readonly search = new SearchField();

  constructor(interaction: InventoryInteraction = new InventoryInteraction()) {
    this.interaction = interaction;
    this.interaction.claimPanelSurfaceClick = (mx, my) => {
      if (!this.hitsSearchField(mx, my)) return false;
      this.search.focus();
      return true;
    };
    this.interaction.canInteractWithBagSlot = (item) => this.matchesSearch(item);
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * The single choke point every close route passes through — a direct
   * assignment (`panel.isOpen = false`), `toggle()`, and the close-button
   * click all end up here. Closing tears down the panel's own sub-menus and
   * notifies {@link onClosingSubPanels}, so a right-click menu, a description
   * popup, an item mid-drag or a host-owned overlay spawned from one of them
   * can never survive the panel closing out from under it.
   */
  set isOpen(open: boolean) {
    if (this._isOpen === open) return;
    this._isOpen = open;
    if (!open) {
      this.resetSearch();
      this.interaction.closeSubmenus();
      this.onClosingSubPanels?.();
    }
  }

  private hitsSearchField(mx: number, my: number): boolean {
    return this.isOpen && this.search.hits(mx, my);
  }

  /**
   * True when the item passes the current filter. An empty query matches
   * everything; the id is matched alongside the name so a shorthand the player
   * knows the item by finds it even when the display name never says it.
   */
  private matchesSearch(item: InventoryItem): boolean {
    const query = this.search.normalizedQuery();
    if (query.length === 0) return true;
    return item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
  }

  /**
   * Drops the query and the keyboard capture with it. Called on every route the
   * panel leaves the screen by: a stale capture would eat the world's keys with
   * nothing on screen to show for it.
   */
  private resetSearch(): void {
    this.search.blur();
    this.search.clear();
  }

  /**
   * Releases the keyboard without discarding what was typed — for an overlay
   * that took the screen out from under a panel the player is coming back to.
   */
  blurSearch(): void {
    this.search.blur();
  }

  /**
   * The keyboard goes back to the game on any click the field did not receive,
   * wherever in a scene's routing chain that click ends up being answered. The
   * field re-takes capture from `claimPanelSurfaceClick` when the click was its
   * own, so calling this first costs a focused field nothing.
   */
  blurSearchUnlessClicked(mx: number, my: number): void {
    if (!this.hitsSearchField(mx, my)) this.search.blur();
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

  toggleBtnRect() {
    // On mobile the button is handled via touch.bagBtnRect in renderMobileButtons.
    // On desktop, sit below the pause button in the right column.
    return {
      x: viewportWidth() - RIGHT_COL_MARGIN - DESKTOP_BTN_W,
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
   * 0 (settled) to 1 (an item just landed) — set by DungeonScene each frame
   * from `RewardFlySystem.bagBouncePulse()` to squash-bounce the bag button.
   */
  bagBouncePulse = 0;

  /**
   * Returns the inventory slot index if (mx, my) is on an inventory slot in the
   * currently-visible page, or null otherwise. Used by DungeonScene for equip-on-click.
   */
  getClickedInventorySlot(mx: number, my: number, inventory: Inventory): number | null {
    if (!this.isOpen) return null;
    const p = this.panelRect();
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      const r = this.invSlotRect(i, p);
      if (pointInRect(mx, my, r)) return slotIdx;
    }
    return null;
  }

  private panelRect() {
    const slotSize = this.slotSize();
    const innerW = COLS * (slotSize + SLOT_GAP) - SLOT_GAP;
    const innerH = ROWS_PER_PAGE * (slotSize + SLOT_GAP) - SLOT_GAP;
    const w = innerW + PANEL_PAD * 2;
    const h = HEADER_H + PANEL_PAD + innerH + PANEL_PAD + NAV_H;
    return {
      x: Math.floor((viewportWidth() - w) / 2),
      y: Math.floor((viewportHeight() - h) / 2),
      w,
      h,
    };
  }

  /** Shrinks the bag cells so the whole panel fits a short or narrow phone viewport. */
  private slotSize(): number {
    const chromeH = HEADER_H + PANEL_PAD * 2 + NAV_H - SLOT_GAP;
    const byHeight = (viewportHeight() - PANEL_SCREEN_MARGIN * 2 - chromeH) / ROWS_PER_PAGE;
    const byWidth = (viewportWidth() - PANEL_SCREEN_MARGIN * 2 - PANEL_PAD * 2 + SLOT_GAP) / COLS;
    return Math.max(1, Math.floor(Math.min(MAX_SLOT_SIZE, byHeight, byWidth) - SLOT_GAP));
  }

  private hotbarRect() {
    return hotbarLayout();
  }

  /** Screen rect for a slot in the paginated grid. `i` is position on current page (0–15). */
  private invSlotRect(i: number, panel: { x: number; y: number }) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const slotSize = this.slotSize();
    return {
      x: panel.x + PANEL_PAD + col * (slotSize + SLOT_GAP),
      y: panel.y + HEADER_H + PANEL_PAD + row * (slotSize + SLOT_GAP),
      w: slotSize,
      h: slotSize,
    };
  }

  private hotbarSlotRect(i: number) {
    const hb = this.hotbarRect();
    return {
      x: hb.x + i * (hb.slotSize + HOTBAR_GAP),
      y: hb.y,
      w: hb.slotSize,
      h: hb.slotSize,
    };
  }

  /** Returns hotbar slot index (0–7) if (mx, my) hits a slot, else -1. */
  getHotbarTappedIndex(mx: number, my: number): number {
    const hb = this.hotbarRect();
    if (my < hb.y - HOTBAR_HIT_MARGIN || my > hb.y + hb.h + HOTBAR_HIT_MARGIN) return -1;
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i);
      if (mx >= r.x && mx <= r.x + r.w) return i;
    }
    return -1;
  }

  /** True if (mx, my) is within the open inventory panel area. */
  hitsPanel(mx: number, my: number): boolean {
    if (!this.isOpen) return false;
    const p = this.panelRect();
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
  getBagSlotRect(slotIdx: number): { x: number; y: number; w: number; h: number } | null {
    if (!this.isOpen) return null;
    const pageStart = this.page * SLOTS_PER_PAGE;
    const pageEnd = pageStart + SLOTS_PER_PAGE;
    if (slotIdx < pageStart || slotIdx >= pageEnd) return null;
    const p = this.panelRect();
    return this.invSlotRect(slotIdx - pageStart, p);
  }

  /**
   * Height of the screen band the hotbar strip occupies, measured up from the
   * bottom of the canvas. Scenes use it to keep world content clear of the bar.
   */
  hotbarBandHeight(): number {
    const hb = this.hotbarRect();
    return viewportHeight() - (hb.y - HOTBAR_STRIP_PAD);
  }

  /** Returns the screen rect of the given hotbar slot index. */
  getHotbarSlotRect(slotIdx: number): { x: number; y: number; w: number; h: number } {
    return this.hotbarSlotRect(slotIdx);
  }

  // Render

  render(
    ctx: CanvasRenderingContext2D,
    inventory: Inventory,
    playerName: string,
    coins: number,
    wieldedWeaponId: ItemId | null = null,
  ): void {
    // The bag clears its own unseen-upgrade set the moment it is actually
    // opened, rather than at the click that opened it — so a scene that opens
    // the panel programmatically (a tutorial step) still clears it correctly.
    if (this.isOpen && !this._wasOpenLastFrame) inventory.unseenUpgrades.clear();
    this._wasOpenLastFrame = this.isOpen;

    this.renderToggleButton(ctx, inventory.unseenUpgrades.size > 0);
    this.renderHotbar(ctx, inventory, wieldedWeaponId);
    if (this.isOpen) {
      this.renderPanel(ctx, inventory, playerName, coins);
    }
    // Dragged item floats on top of everything
    if (this.drag) {
      const s = this.slotSize();
      InventoryPanel.renderItemIcon(
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
      this.renderContextMenu(ctx);
    }
    if (this.interaction.pendingInfoItem) {
      this.renderInfoPopup(ctx, this.interaction.pendingInfoItem);
    }
  }

  private renderContextMenu(ctx: CanvasRenderingContext2D): void {
    const cm = this.contextMenu;
    if (!cm) return;
    const options = this.interaction.contextMenuOptions(cm.item, cm.source, cm.isEquipped);
    const menuW = CONTEXT_MENU_W;
    const menuItemH = CONTEXT_MENU_ITEM_HEIGHT;
    const menuH = options.length * menuItemH + CONTEXT_MENU_V_PAD;
    // Already on-screen: `InventoryInteraction.openContextMenu` resolved the
    // origin once, so hit-testing and this drawing can't disagree.
    const mx = cm.x;
    const my = cm.y;

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
      const disabled = this.interaction.isDisabledOption(cm.item, options[i]);
      const color = disabled
        ? CONTEXT_DISABLED_COLOR
        : options[i] === 'Equip'
          ? '#4ade80'
          : options[i] === 'Unequip'
            ? '#f87171'
            : '#e2e8f0';
      // baseline_y=oy+15, size=11 → top_y = oy+15-9 = oy+6
      drawText(ctx, options[i], {
        x: mx + INFO_LABEL_X_OFFSET,
        y: oy + Math.round((menuItemH - CONTEXT_LABEL_SIZE) / 2),
        size: CONTEXT_LABEL_SIZE,
        color,
      });
    }
    ctx.restore();
  }

  private renderInfoPopup(ctx: CanvasRenderingContext2D, item: InventoryItem): void {
    const popW = Math.min(INFO_POPUP_MAX_W, viewportWidth() - INFO_POPUP_MARGIN);
    const lineH = INFO_POPUP_LINE_H;
    const pad = INFO_POPUP_PAD;

    const descText = item.description ?? 'No description available.';
    const textW = popW - pad * 2;

    // Estimate popup height: title lines + divider space + description lines + hint
    // Use a rough line estimate for pre-draw sizing (similar to original)
    const titleLines = measureTextBox(ctx, item.name, {
      size: INFO_POPUP_TITLE_SIZE,
      bold: true,
      width: textW,
      lineHeight: lineH,
    }).lineCount;
    const approxDescLines = Math.ceil(descText.length / INFO_POPUP_DESC_CHARS_PER_LINE) || 1;
    const popH =
      pad + titleLines * lineH + pad * INFO_POPUP_PAD_HALF + approxDescLines * lineH + pad;
    const px = Math.floor((viewportWidth() - popW) / 2);
    const py = Math.floor((viewportHeight() - popH) / 2);

    ctx.save();
    drawBox(ctx, {
      x: px,
      y: py,
      width: popW,
      height: popH,
      ...BOX_PRESETS.tooltip,
      borderWidth: 1.5,
    });

    // Title: baseline_y = py+pad+lineH-3, size=11 → top_y = baseline_y - 9; wraps onto
    // as many lines as it needs, so a long enchanted-gear name never spills past the box.
    drawText(ctx, item.name, {
      x: px + pad,
      y: py + pad + lineH - INFO_TITLE_BOTTOM_OFFSET - INFO_POPUP_TITLE_CORRECTION,
      bold: true,
      size: INFO_POPUP_TITLE_SIZE,
      color: '#e2e8f0',
      width: textW,
      lineHeight: lineH,
    });

    // Divider
    drawDivider(ctx, {
      x: px + INFO_DIVIDER_OFFSET_X,
      y: py + pad + titleLines * lineH + 2,
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
        lineH * (titleLines + 1) -
        INFO_POPUP_DESC_BASELINE_OFFSET -
        INFO_POPUP_DESC_BASELINE_CORRECTION,
      size: INFO_POPUP_DESC_SIZE,
      color: '#94a3b8',
      width: textW,
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

  private renderToggleButton(ctx: CanvasRenderingContext2D, hasUnseenUpgrade: boolean): void {
    if (!platform.showDesktopToggleButtons) return;
    const btn = this.toggleBtnRect();
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    const bounceScale = 1 + Math.sin(this.bagBouncePulse * Math.PI) * BAG_BOUNCE_SCALE_AMOUNT;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(bounceScale, bounceScale);
    ctx.translate(-cx, -cy);
    drawButton(ctx, {
      x: btn.x,
      y: btn.y,
      width: btn.w,
      height: btn.h,
      label: `Bag [${keybindings.labelFor('toggleInventory')}]`,
      ...(this.isOpen ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
    });
    drawSatchelIcon(
      ctx,
      btn.x + TOGGLE_ICON_PAD,
      btn.y + (btn.h - TOGGLE_ICON_SIZE) / 2,
      TOGGLE_ICON_SIZE,
    );
    if (hasUnseenUpgrade) this.renderUnseenUpgradeBadge(ctx, btn.x + btn.w, btn.y);
    ctx.restore();
  }

  /** The small pip that says the bag holds gear better than what's worn. */
  private renderUnseenUpgradeBadge(
    ctx: CanvasRenderingContext2D,
    right: number,
    top: number,
  ): void {
    ctx.save();
    ctx.fillStyle = '#4ade80';
    ctx.strokeStyle = '#052e16';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      right - UNSEEN_BADGE_RADIUS,
      top + UNSEEN_BADGE_RADIUS,
      UNSEEN_BADGE_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * @param wieldedWeaponId The weapon the bar's owner is holding, which reads on
   *   the bar exactly like worn gear — it is in hand and it is not being spent.
   */
  private renderHotbar(
    ctx: CanvasRenderingContext2D,
    inventory: Inventory,
    wieldedWeaponId: ItemId | null,
  ): void {
    const hb = this.hotbarRect();
    // Background strip
    drawBox(ctx, {
      x: hb.x - HOTBAR_STRIP_PAD,
      y: hb.y - HOTBAR_STRIP_PAD,
      width: hb.w + HOTBAR_STRIP_PAD * 2,
      height: hb.h + HOTBAR_STRIP_EXTRA_H,
      fill: 'rgba(0,0,0,0.65)',
    });

    const draggedItem = this.drag?.item ?? null;
    const deniesEverySlot = draggedItem !== null && !itemCanHotlist(draggedItem.id);

    for (let i = 0; i < HOTBAR_COUNT; i++) {
      const r = this.hotbarSlotRect(i);
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
        hotbarItem !== null &&
          (inventory.hasEquipped(hotbarItem.id) || hotbarItem.id === wieldedWeaponId),
        hotbarItem !== null && inventory.unseenUpgrades.has(hotbarItem.id),
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

      // The quest slot never accepts a drop of anything — dragging any item
      // there is a no-op, not a hotlist-specific refusal — so it's excluded
      // here rather than marked as though it were a normal denied target.
      if (deniesEverySlot && i !== QUEST_SLOT_IDX) this.renderDenyMark(ctx, r);
    }
  }

  /** The circle-and-bar "no" laid over a hotbar slot that refuses the drag. */
  private renderDenyMark(
    ctx: CanvasRenderingContext2D,
    slot: { x: number; y: number; w: number; h: number },
  ): void {
    const centerX = slot.x + slot.w / 2;
    const centerY = slot.y + slot.h / 2;
    const radius = Math.min(slot.w, slot.h) * HOTBAR_DENY_RADIUS_FRACTION;

    ctx.save();
    ctx.globalAlpha = HOTBAR_DENY_ALPHA;
    ctx.strokeStyle = HOTBAR_DENY_COLOR;
    ctx.lineWidth = HOTBAR_DENY_BAR_WIDTH;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    const barDx = Math.cos(HOTBAR_DENY_BAR_ANGLE) * radius;
    const barDy = Math.sin(HOTBAR_DENY_BAR_ANGLE) * radius;
    ctx.beginPath();
    ctx.moveTo(centerX - barDx, centerY + barDy);
    ctx.lineTo(centerX + barDx, centerY - barDy);
    ctx.stroke();

    ctx.restore();
  }

  private renderPanel(
    ctx: CanvasRenderingContext2D,
    inventory: Inventory,
    playerName: string,
    coins: number,
  ): void {
    const p = this.panelRect();

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

    // Header — the hovered item's name takes over the strip, falling back to
    // the player/inventory label the rest of the time.
    drawText(ctx, this.hoveredItem ? this.hoveredItem.name : `${playerName} Inventory`, {
      x: p.x + PANEL_PAD,
      y: p.y + PANEL_NAME_Y,
      bold: true,
      size: PANEL_HEADER_NAME_SIZE,
      color: this.hoveredItem ? '#facc15' : '#e2e8f0',
      width: p.w - PANEL_PAD - PANEL_HEADER_COINS_OFFSET - PANEL_HEADER_COINS_TITLE_GAP,
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

    this.search.render(
      ctx,
      p.x + PANEL_PAD,
      p.y + SEARCH_FIELD_Y,
      p.w - PANEL_PAD * 2,
      SEARCH_FIELD_H,
    );

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
      const filteredOut = item !== null && !this.matchesSearch(item);
      const r = this.invSlotRect(i, p);
      this.renderSlot(
        ctx,
        r.x,
        r.y,
        r.w,
        item,
        isDragged || filteredOut,
        false,
        inventory.isSlotEquipped(slotIdx),
        item !== null && inventory.unseenUpgrades.has(item.id),
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
    isUnseenUpgrade = false,
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = SLOT_DIMMED_ALPHA;

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
      InventoryPanel.renderItemIcon(ctx, item, x, y, size, 1);
    } else if (item && dimmed) {
      ctx.globalAlpha = SLOT_DIMMED_ALPHA;
      InventoryPanel.renderItemIcon(ctx, item, x, y, size, 1);
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

    // "NEW" pip (top-right corner) — an unseen upgrade sitting in this slot
    if (isUnseenUpgrade && item && !dimmed) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#4ade80';
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + size - NEW_PIP_INSET, y + NEW_PIP_INSET, NEW_PIP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Ability cooldown overlay on hotbar
    // Keyed by ability first, item id second, so a plain item with a cooldown of
    // its own — the Wayfinder's Anchor — wears the same overlay as an ability.
    const cooldownKey = item?.abilityId ?? item?.id;
    if (isHotbar && cooldownKey !== undefined) {
      const cd = this.abilityCooldowns.get(cooldownKey);
      if (cd) {
        drawCooldownOverlay(ctx, {
          x,
          y,
          width: size,
          height: size,
          remainingFrames: cd.current,
          totalFrames: cd.max,
        });
      }
    }

    ctx.restore();
  }

  /**
   * The per-item procedural icon, drawn into a square of `size` at (x, y).
   *
   * Kept as a static alias of {@link drawItemIcon}, which owns the drawing:
   * several surfaces outside this module already call it by this name.
   */
  static renderItemIcon(
    ctx: CanvasRenderingContext2D,
    item: InventoryItem,
    x: number,
    y: number,
    size: number,
    alpha: number,
  ): void {
    drawItemIcon(ctx, item, x, y, size, alpha);
  }

  // Interaction

  handleClick(mx: number, my: number, inventory: Inventory): boolean {
    const p = this.panelRect();

    // Repeated from the scene's own entry guard, for the callers that reach the
    // panel without going through one.
    this.blurSearchUnlessClicked(mx, my);

    return this.interaction.handleClick(
      mx,
      my,
      inventory,
      this.isOpen,
      () => this.toggle(),
      this.toggleBtnRect(),
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

  handleMouseDown(mx: number, my: number, inventory: Inventory): void {
    this.interaction.handleMouseDown(
      mx,
      my,
      inventory,
      this.isOpen,
      (i) => this.hotbarSlotRect(i),
      this.panelRect(),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  openContextMenu(mx: number, my: number, inventory: Inventory): void {
    this.interaction.openContextMenu(
      mx,
      my,
      inventory,
      this.isOpen,
      (i) => this.hotbarSlotRect(i),
      this.panelRect(),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }

  handleMouseMove(mx: number, my: number, inventory: Inventory | null = null): void {
    this.interaction.handleMouseMove(mx, my);
    this.hoveredItem = inventory ? this.itemAt(mx, my, inventory) : null;
    if (this.hoveredItem) inventory?.unseenUpgrades.delete(this.hoveredItem.id);
  }

  /** The bag or hotbar item under `(mx, my)`, or null. Drives hover naming and clears its "NEW" pip. */
  private itemAt(mx: number, my: number, inventory: Inventory): InventoryItem | null {
    for (let i = 0; i < HOTBAR_COUNT; i++) {
      if (pointInRect(mx, my, this.hotbarSlotRect(i))) return inventory.actionBar.slots[i];
    }
    if (!this.isOpen) return null;
    const p = this.panelRect();
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const slotIdx = pageStart + i;
      if (slotIdx >= inventory.bag.slots.length) break;
      if (pointInRect(mx, my, this.invSlotRect(i, p))) return inventory.bag.slots[slotIdx];
    }
    return null;
  }

  handleMouseUp(mx: number, my: number, inventory: Inventory): void {
    this.interaction.handleMouseUp(
      mx,
      my,
      inventory,
      this.isOpen,
      (i) => this.hotbarSlotRect(i),
      this.panelRect(),
      (i, p) => this.invSlotRect(i, p),
      this.page,
    );
  }
}

/** Screen space the hotbar's slots take, from which every hotbar rect is derived. */
function hotbarLayout(): { x: number; y: number; w: number; h: number; slotSize: number } {
  const available = viewportWidth() - HOTBAR_SIDE_MARGIN * 2 - HOTBAR_GAP * (HOTBAR_COUNT - 1);
  const s = Math.min(HOTBAR_SLOT_SIZE, Math.floor(available / HOTBAR_COUNT));
  const w = HOTBAR_COUNT * (s + HOTBAR_GAP) - HOTBAR_GAP;
  return {
    x: Math.floor((viewportWidth() - w) / 2),
    y: viewportHeight() - s - HOTBAR_BOTTOM_MARGIN,
    w,
    h: s,
    slotSize: s,
  };
}

/**
 * The hotbar's whole strip on screen, backing panel included — what other HUD
 * chrome has to keep clear of.
 */
export function hotbarStripRect(): { x: number; y: number; w: number; h: number } {
  const hb = hotbarLayout();
  return {
    x: hb.x - HOTBAR_STRIP_PAD,
    y: hb.y - HOTBAR_STRIP_PAD,
    w: hb.w + HOTBAR_STRIP_PAD * 2,
    h: hb.h + HOTBAR_STRIP_EXTRA_H,
  };
}

/**
 * The per-item procedural icon, drawn into a square of `size` at (x, y).
 *
 * A free function rather than a method because it reads nothing off the panel:
 * every surface that shows an item needs the same picture, and a second
 * hand-drawn copy would drift the moment an icon changes.
 *
 * @param alpha Multiplied into the context own alpha, for drag ghosts.
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  item: InventoryItem,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  drawItemArt(ctx, item, x, y, size, alpha);
  drawQuantityBadge(ctx, item, x, y, size, alpha);
}

/**
 * The item picture alone. Many icon families finish early with their own
 * `return`, so the quantity badge lives in {@link drawQuantityBadge} where no
 * branch here can skip it.
 */
function drawItemArt(
  ctx: CanvasRenderingContext2D,
  item: InventoryItem,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * alpha;

  if (item.skillId !== undefined) {
    drawSkillBookIcon(ctx, x, y, size, item.skillId);
    ctx.restore();
    return;
  }

  if (item.explosivesHandlingLevels !== undefined) {
    drawBookIcon(ctx, x, y, size, EXPLOSIVES_TOME_COVER);
    const emblemSize = size * EXPLOSIVES_TOME_EMBLEM_SCALE;
    const emblemX = x + (size - emblemSize) / 2 + size * EXPLOSIVES_TOME_EMBLEM_SPINE_OFFSET;
    const emblemY = y + (size - emblemSize) / 2;
    drawDynamiteInventoryIcon(ctx, emblemX, emblemY, emblemSize);
    ctx.restore();
    return;
  }

  if (isIssueKitItem(item.id)) {
    drawIssueKitIcon(ctx, x, y, size, item.id);
    ctx.restore();
    return;
  }

  if (isEnchantedGearItem(item.id)) {
    drawEnchantedGearIcon(ctx, x, y, size, item.id);
    ctx.restore();
    return;
  }

  if (item.id === 'wayfinders_anchor') {
    drawAnchorStoneIcon(ctx, x, y, size);
    ctx.restore();
    return;
  }

  if (isAnchorShardId(item.id)) {
    drawAnchorShardIcon(ctx, x, y, size);
    ctx.restore();
    return;
  }

  if (isResourceIconId(item.id)) {
    drawResourceIcon(ctx, item.id, x, y, size);
    ctx.restore();
    return;
  }

  if (isToolIconId(item.id)) {
    drawToolIcon(ctx, item.id, x, y, size);
    ctx.restore();
    return;
  }

  if (isFoodIconId(item.id)) {
    drawFoodIcon(ctx, item.id, x, y, size);
    ctx.restore();
    return;
  }

  if (isKitIconId(item.id)) {
    drawKitIcon(ctx, item.id, x, y, size);
    ctx.restore();
    return;
  }

  if (item.id === 'magistrates_writ') {
    drawMagistratesWritIcon(ctx, x, y, size);
    ctx.restore();
    return;
  }

  if (item.id === 'unreadable_letter') {
    drawUnreadableLetterIcon(ctx, x, y, size);
    ctx.restore();
    return;
  }

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

  if (item.id === 'doomsday_scenario') {
    const caseX = x + size * DOOMSDAY_CASE_INSET;
    const caseY = y + size * DOOMSDAY_CASE_TOP;
    const caseW = size - size * DOOMSDAY_CASE_INSET * 2;
    const caseH = size * DOOMSDAY_CASE_BOTTOM - size * DOOMSDAY_CASE_TOP;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.fillRect(caseX, caseY, caseW, caseH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(caseX, caseY, caseW, caseH);

    const cx = x + size * DOOMSDAY_CRYSTAL_CX;
    const cy = y + size * DOOMSDAY_CRYSTAL_CY;
    const hw = size * DOOMSDAY_CRYSTAL_W;
    const hh = size * DOOMSDAY_CRYSTAL_H;
    ctx.fillStyle = '#a855f7';
    ctx.shadowColor = '#f43f5e';
    ctx.shadowBlur = DOOMSDAY_CRYSTAL_GLOW_BLUR;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
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
    ctx.bezierCurveTo(hx, hy - hs * HEART_TOP_CTRL, hx - hs, hy - hs * HEART_TOP_CTRL, hx - hs, hy);
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

  if (item.id === 'dirty_shirley') {
    const cx = x + size * DIRTY_SHIRLEY_CX;
    const glassTopY = y + size * DIRTY_SHIRLEY_GLASS_TOP_Y;
    const glassBottomY = y + size * DIRTY_SHIRLEY_GLASS_BOTTOM_Y;
    const glassLeftX = cx - size * DIRTY_SHIRLEY_GLASS_HALF_W;
    const glassRightX = cx + size * DIRTY_SHIRLEY_GLASS_HALF_W;

    // Faint glass body under the liquid so the tumbler's walls read past the fill line
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(glassLeftX, glassTopY, glassRightX - glassLeftX, glassBottomY - glassTopY);

    const liquidTopY = y + size * DIRTY_SHIRLEY_LIQUID_TOP_Y;
    const liquidLeftX = glassLeftX + size * DIRTY_SHIRLEY_LIQUID_INSET;
    const liquidRightX = glassRightX - size * DIRTY_SHIRLEY_LIQUID_INSET;

    // Deep grenadine red settles at the bottom, lighter ginger-ale fizz rises to the top
    const liquidGradient = ctx.createLinearGradient(0, liquidTopY, 0, glassBottomY);
    liquidGradient.addColorStop(0, '#fda4af');
    liquidGradient.addColorStop(1, '#7f1d3d');
    ctx.fillStyle = liquidGradient;
    ctx.fillRect(liquidLeftX, liquidTopY, liquidRightX - liquidLeftX, glassBottomY - liquidTopY);

    // Rim ellipse reads as the glass's top opening
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      glassTopY,
      size * DIRTY_SHIRLEY_GLASS_HALF_W,
      size * DIRTY_SHIRLEY_RIM_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    // A pale stripe down one side sells the glass over the liquid
    ctx.fillStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_HIGHLIGHT_ALPHA})`;
    ctx.fillRect(
      glassLeftX + size * DIRTY_SHIRLEY_HIGHLIGHT_X_OFFSET,
      glassTopY,
      size * DIRTY_SHIRLEY_HIGHLIGHT_W,
      glassBottomY - glassTopY,
    );

    // A few fizz bubbles rising through the liquid
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const bubbleFracs: Array<[number, number]> = [
      [DIRTY_SHIRLEY_BUBBLE_1_X, DIRTY_SHIRLEY_BUBBLE_1_Y],
      [DIRTY_SHIRLEY_BUBBLE_2_X, DIRTY_SHIRLEY_BUBBLE_2_Y],
      [DIRTY_SHIRLEY_BUBBLE_3_X, DIRTY_SHIRLEY_BUBBLE_3_Y],
    ];
    for (const [bxFrac, byFrac] of bubbleFracs) {
      ctx.beginPath();
      ctx.arc(x + size * bxFrac, y + size * byFrac, size * DIRTY_SHIRLEY_BUBBLE_R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Maraschino cherry perched on the rim, with a thin curved stem
    const cherryX = cx + size * DIRTY_SHIRLEY_CHERRY_X_OFFSET;
    const cherryY = glassTopY + size * DIRTY_SHIRLEY_CHERRY_Y_OFFSET;
    const cherryR = size * DIRTY_SHIRLEY_CHERRY_R;

    ctx.strokeStyle = '#4d7c0f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cherryX, cherryY - cherryR);
    ctx.quadraticCurveTo(
      cherryX + size * DIRTY_SHIRLEY_STEM_CTRL_X_OFFSET,
      cherryY + size * DIRTY_SHIRLEY_STEM_CTRL_Y_OFFSET,
      cherryX + size * DIRTY_SHIRLEY_STEM_END_X_OFFSET,
      cherryY + size * DIRTY_SHIRLEY_STEM_END_Y_OFFSET,
    );
    ctx.stroke();

    ctx.fillStyle = '#7f1d3d';
    ctx.beginPath();
    ctx.arc(cherryX, cherryY, cherryR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(
      cherryX + size * DIRTY_SHIRLEY_CHERRY_SHINE_X_OFFSET,
      cherryY + size * DIRTY_SHIRLEY_CHERRY_SHINE_Y_OFFSET,
      size * DIRTY_SHIRLEY_CHERRY_SHINE_R,
      0,
      Math.PI * 2,
    );
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

  ctx.restore();
}

/** Bottom-right stack count, shown for any stack the player holds more than one of. */
function drawQuantityBadge(
  ctx: CanvasRenderingContext2D,
  item: InventoryItem,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (item.quantity <= 1) return;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * alpha;
  const fontSize = Math.max(QTY_BADGE_MIN_FONT, Math.floor(size * QTY_BADGE_FONT_SCALE));
  drawText(ctx, item.quantity.toString(), {
    x: x + size - QTY_BADGE_MARGIN,
    y: y + size - QTY_BADGE_MARGIN - fontSize,
    size: fontSize,
    bold: true,
    color: '#fff',
    align: 'right',
    outline: true,
    outlineWidth: QTY_BADGE_OUTLINE_WIDTH,
  });
  ctx.restore();
}
