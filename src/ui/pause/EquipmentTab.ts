/**
 * The Equipment tab: a paper doll on the left, the same crawler's bag on the
 * right, and every route between them.
 *
 * Three ways to move a piece of gear, because each covers a hole the others
 * leave: drag for the mouse, click-a-slot-then-click-an-item for the keyboard
 * and for touch, and click-a-worn-item to take it off. The drag is the only one
 * a keyboard cannot reach, which is why nothing is reachable *only* by drag.
 *
 * It deliberately draws neither an overlay nor a modal — `PauseMenu` owns the
 * box this renders inside, and owns the focus ring these buttons join.
 */

import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AudioManager } from '../../audio/AudioManager';
import type { Inventory } from '../../core/Inventory';
import {
  ALL_RESISTANCE_TYPES,
  isWearable,
  itemFitsSubSlot,
  SLOTS_PER_PAGE,
} from '../../core/ItemDefs';
import type { InventoryItem } from '../../core/ItemDefs';
import type { CrawlerKind } from '../../core/SkillManager';
import { ALL_STATS, type StatName } from '../../Player';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, drawButton, BUTTON_PRESETS } from '../Button';
import { drawText, TEXT_PRESETS } from '../TextBox';
import { drawBox, BOX_PRESETS } from '../Box';
import { InventoryPanel } from '../InventoryPanel';
import { SearchField } from '../SearchField';
import { drawItemTooltip } from '../ItemTooltip';
import {
  buildEquipSlotInfos,
  equipLayoutBottomY,
  equipSectionTopY,
  equipSlotKeyAt,
  EQUIP_PANEL_PAD,
  EQUIP_SECTION_LABEL_W,
  EQUIP_SLOT_ORDER,
  type EquipSlotInfo,
} from '../equipmentLayout';
import { pointInRect } from '../../utils';
import { viewportWidth, viewportHeight } from '../../core/Viewport';

/** Modal size this tab asks `PauseMenu` for: wide enough for two columns. */
export const EQUIPMENT_TAB_BOX_W = 620;
export const EQUIPMENT_TAB_BOX_H = 500;

const TITLE_Y = 14;
const TITLE_SIZE = 16;

/** Band holding the crawler toggles on the left and the search field on the right. */
const HEADER_ROW_Y = 36;
const HEADER_ROW_H = 24;
const HEADER_BUTTON_GAP = 6;

/** Top of both columns' content, below the header band. */
const CONTENT_TOP_Y = 68;

const EQUIPMENT_SLOT_SIZE = 46;
const EQUIPMENT_SLOT_GAP = 3;
/**
 * Below this a cell cannot hold both an icon and a readable two-line sub-slot
 * label, so a narrow doll wraps a row (Hands/Feet, five sub-slots each) onto a
 * second line instead of shrinking every cell past this floor.
 */
const EQUIPMENT_SLOT_MIN_SIZE = 34;
/** The widest row the doll ever needs: Hands and Feet each carry five sub-slots. */
const DOLL_MAX_CELLS_PER_ROW = 5;
/** Share of the modal the doll column may take before the bag would be squeezed. */
const DOLL_COLUMN_MAX_FRACTION = 0.58;

const BAG_COLS = 4;
const BAG_ROWS = SLOTS_PER_PAGE / BAG_COLS;
const BAG_CELL_SIZE = 50;
const BAG_CELL_GAP = 4;
const BAG_CELL_MIN_SIZE = 20;

const SECTION_LABEL_SIZE = 9;
const SECTION_LABEL_COLOR = '#64748b';
/** Section labels sit against the vertical middle of their first row of cells. */
const SECTION_LABEL_Y_FRACTION = 0.5;
const SECTION_LABEL_BASELINE_LIFT = 5;

const SUBSLOT_LABEL_SIZE = 8;
const SUBSLOT_LABEL_LINE_HEIGHT = 9;
/** Reserved even for a label that only needs one line, so the block's bottom edge never moves. */
const SUBSLOT_LABEL_LINES = 2;
const SUBSLOT_LABEL_BLOCK_H = SUBSLOT_LABEL_LINE_HEIGHT * SUBSLOT_LABEL_LINES;
const SUBSLOT_LABEL_BOTTOM_PAD = 2;
const SUBSLOT_LABEL_SIDE_PAD = 2;

/** Icons leave the cell's rim visible, so the border still reads as a slot. */
const ICON_INSET = 4;

/** Matches the bag panel's dim, so a filtered-out slot reads the same on both screens. */
const CELL_INERT_ALPHA = 0.35;

const TOTALS_GAP_ABOVE = 10;
const TOTALS_LINE_HEIGHT = 14;
const TOTALS_SIZE = 10;
const TOTALS_COLOR = '#94a3b8';
/** A panel cannot show everything: the rest of an item's effects live in its tooltip. */
const TOTALS_MAX_LINES = 4;
const TOTALS_OVERFLOW_LINE = '…more on each item';
const NO_BONUSES_LINE = 'No stat bonuses worn.';

const NAV_ROW_GAP = 8;
const NAV_ROW_H = 22;
const NAV_BUTTON_GAP = 6;
const NAV_LABEL_SIZE = 10;
/** Gap between the Prev/Next row and the "page X / Y" line beneath it. */
const PAGE_LABEL_GAP = 4;
const PAGE_LABEL_LINE_H = 12;

const HINT_GAP = 8;
const HINT_SIZE = 9;

const BACK_BUTTON_H = 30;
const BACK_BUTTON_BOTTOM_MARGIN = 10;

const REFUSAL_SIZE = 10;
/** Roughly two seconds at 60 Hz — long enough to read, short enough not to nag. */
const REFUSAL_FRAMES = 120;
const REFUSAL_SOUND = 'error';

const NOT_WEARABLE_REFUSAL = "That isn't something you can wear.";
const WRONG_SLOT_REFUSAL = "That doesn't go there.";
const ALREADY_WORN_REFUSAL = "That's already being worn.";

/** Pointer travel past which a press is a drag, so the click behind it is not a second action. */
const DRAG_SLOP_PX = 6;

/**
 * The circle-and-bar "no" laid over a doll sub-slot that refuses the piece of
 * gear currently in hand — the same mark `InventoryPanel` lays over hotbar
 * slots that refuse a dragged item, so the two drags read as one language.
 */
const DENY_MARK_RADIUS_FRACTION = 0.3;
const DENY_MARK_COLOR = '#ef4444';
const DENY_MARK_ALPHA = 0.8;
const DENY_MARK_BAR_WIDTH = 4;
const DENY_MARK_RIGHT_ANGLE_RADIANS = Math.PI / 2;
/** The bar lies on the square slot's diagonal — half a right angle. */
const DENY_MARK_BAR_ANGLE = DENY_MARK_RIGHT_ANGLE_RADIANS / 2;

/** How long a still press on a bag item takes to open its context menu instead of a drag/tap. */
const BAG_LONG_PRESS_MS = 500;

const CONTEXT_MENU_WIDTH = 140;
const CONTEXT_MENU_OPTION_H = 30;
const CONTEXT_MENU_PAD = 4;
const CONTEXT_MENU_LABEL_SIZE = 12;
/** Keeps the popup from drawing off the right/bottom edge of the viewport. */
const CONTEXT_MENU_SCREEN_MARGIN = 8;

const CONTEXT_OPTION_EQUIP = 'Equip';
const CONTEXT_OPTION_UNEQUIP = 'Unequip';
const CONTEXT_OPTION_DESCRIPTION = 'Description';
const CONTEXT_OPTION_CANCEL = 'Cancel';

/** The dragged item follows the cursor at this size, centred on it. */
const DRAG_GHOST_SIZE = 40;
const DRAG_GHOST_ALPHA = 0.85;

const TOOLTIP_EQUIP_FOOTER = '[Click] Equip';
const TOOLTIP_UNEQUIP_FOOTER = '[Click] Unequip';

/** Multiplier→percentage conversion for the lines that read as percentages. */
const PERCENT = 100;

const STAT_ABBREVIATIONS: Record<StatName, string> = {
  strength: 'STR',
  intelligence: 'INT',
  constitution: 'CON',
  dexterity: 'DEX',
};

const RESISTANCE_NAMES: Record<(typeof ALL_RESISTANCE_TYPES)[number], string> = {
  poison: 'Poison',
  ice: 'Ice',
  piercing: 'Piercing',
};

/** The names the pause menu already calls the two crawlers by. */
const CRAWLER_LABELS: Record<CrawlerKind, string> = { human: 'Human', cat: 'Cat' };
const CRAWLER_ORDER = ['human', 'cat'] as const satisfies readonly CrawlerKind[];

interface DragCommon {
  item: InventoryItem;
  mx: number;
  my: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** Where a drag picked its item up, which is what a release has to undo or complete. */
type EquipDrag =
  | (DragCommon & { origin: 'bag'; slotIdx: number })
  | (DragCommon & { origin: 'slot'; key: string });

interface BagCell {
  slotIdx: number;
  x: number;
  y: number;
}

/**
 * Everything the last render resolved, kept so a press arriving between two
 * frames hit-tests against what the player is actually looking at.
 */
interface EquipmentLayout {
  slotInfos: EquipSlotInfo[];
  slotSize: number;
  bagCells: BagCell[];
  bagCellSize: number;
}

function pageCount(slotCount: number): number {
  return Math.max(1, Math.ceil(slotCount / SLOTS_PER_PAGE));
}

/** The `Slot` half of a `"Slot:SubSlot"` key. */
function keySlot(key: string): string {
  return key.split(':')[0] ?? '';
}

/** The `SubSlot` half of a `"Slot:SubSlot"` key. */
function keySubSlot(key: string): string {
  return key.split(':')[1] ?? '';
}

function asPercent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

/**
 * The worn-gear summary under the doll: real totals from the equipment
 * aggregators rather than a merge of per-item lines, because two items that each
 * reflect 10% reflect 20% together and a merged list would claim 10%.
 */
function summariseWornGear(inventory: Inventory): string[] {
  const lines: string[] = [];
  const equipment = inventory.equipment;

  const bonuses = equipment.getStatBonuses();
  const statParts = ALL_STATS.filter((stat) => bonuses[stat] !== 0).map(
    (stat) => `${STAT_ABBREVIATIONS[stat]} +${bonuses[stat]}`,
  );
  lines.push(statParts.length > 0 ? statParts.join('   ') : NO_BONUSES_LINE);

  const resisted = ALL_RESISTANCE_TYPES.filter((type) => equipment.hasResistance(type)).map(
    (type) => RESISTANCE_NAMES[type],
  );
  if (resisted.length > 0) lines.push(`Resists: ${resisted.join(', ')}`);

  const reflect = equipment.getDamageReflectPct();
  if (reflect > 0) lines.push(`Reflects ${asPercent(reflect)}% of melee damage`);

  const stun = equipment.getStunOnHitChance();
  if (stun > 0) lines.push(`${asPercent(stun)}% stun on hit`);

  if (equipment.getCancelsMomentum()) lines.push('Momentum attacks cannot touch you');

  return lines;
}

/**
 * Owns everything about the tab that has to survive a frame: which crawler is on
 * screen, which bag page, the query, the drag in flight, and the sub-slot the
 * player asked "what fits here?" about.
 *
 * A bundle rather than six fields on `PauseMenu` because they reset together —
 * every route off this tab has to drop all of them at once, and a reset that
 * forgets one leaves a drag hanging over another tab or the keyboard captured by
 * a search box nobody can see any more.
 */
export class EquipmentTabController {
  /** Audio for the refusal cue. Set by `PauseMenu`, which owns the mixer reference. */
  audio: AudioManager | null = null;

  private side: CrawlerKind = 'human';
  private page = 0;
  private drag: EquipDrag | null = null;
  /** The sub-slot whose eligible items the bag is highlighting, or null. */
  private filterKey: string | null = null;
  private readonly search = new SearchField();
  private layout: EquipmentLayout | null = null;

  private hoverKey: string | null = null;
  private hoverBagIdx: number | null = null;
  private pointerX = 0;
  private pointerY = 0;

  private refusal: string | null = null;
  private refusalFramesLeft = 0;

  /**
   * Set by a release that moved. The browser fires `click` right after
   * `mouseup`, so without this the cell a drag landed on would answer the drop
   * and then answer a click on top of it.
   */
  private suppressNextClick = false;

  /**
   * Whoever the doll belongs to, pinned during render so the button actions
   * closed over in it can report a stat change. Those actions fire after the
   * frame, when nobody is passing the crawlers around any more.
   */
  private owner: HumanPlayer | CatPlayer | null = null;

  /** Fires while a bag press holds still long enough, opening its context menu. */
  private pressTimer: ReturnType<typeof setTimeout> | null = null;

  /** A bag item's popup menu — equip/unequip, description, cancel. */
  private contextMenu: { slotIdx: number; item: InventoryItem; x: number; y: number } | null = null;
  /** The item a "Description" choice pinned open, shown until the next click. */
  private descriptionItem: InventoryItem | null = null;

  /**
   * Drop every scrap of tab state and release the keyboard.
   *
   * Called on tab switch and on pause close: a search field left holding capture
   * eats the world's keys with nothing on screen to explain why.
   */
  reset(): void {
    this.drag = null;
    this.filterKey = null;
    this.page = 0;
    this.search.blur();
    this.search.clear();
    this.hoverKey = null;
    this.hoverBagIdx = null;
    this.refusal = null;
    this.refusalFramesLeft = 0;
    this.suppressNextClick = false;
    this.layout = null;
    this.clearPressTimer();
    this.contextMenu = null;
    this.descriptionItem = null;
  }

  /**
   * Escape's first meaning on this tab: back out of the drag or the filter
   * before it means "close the menu". Returns true when it consumed the press.
   */
  dismissEscape(): boolean {
    if (this.contextMenu !== null || this.descriptionItem !== null) {
      this.contextMenu = null;
      this.descriptionItem = null;
      return true;
    }
    if (this.drag !== null) {
      this.drag = null;
      return true;
    }
    if (this.filterKey !== null) {
      this.filterKey = null;
      return true;
    }
    return false;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    human: HumanPlayer,
    cat: CatPlayer,
    setTab: (tab: PauseTab) => void,
  ): void {
    if (this.refusalFramesLeft > 0) {
      this.refusalFramesLeft--;
      if (this.refusalFramesLeft === 0) this.refusal = null;
    }

    const player = this.selectedPlayer(human, cat);
    this.owner = player;
    const inventory = player.inventory;

    drawText(ctx, 'EQUIPMENT', {
      x: boxX + boxW / 2,
      y: boxY + TITLE_Y,
      bold: true,
      size: TITLE_SIZE,
      color: '#f1f5f9',
      align: 'center',
    });

    const dollW = Math.min(
      EQUIP_PANEL_PAD * 2 +
        EQUIP_SECTION_LABEL_W +
        DOLL_MAX_CELLS_PER_ROW * (EQUIPMENT_SLOT_SIZE + EQUIPMENT_SLOT_GAP),
      Math.floor(boxW * DOLL_COLUMN_MAX_FRACTION),
    );
    const bagX = boxX + dollW;
    const bagW = boxW - dollW - EQUIP_PANEL_PAD;

    this.renderCrawlerToggles(ctx, buttons, boxX, boxY, dollW);

    const doll = this.renderDoll(ctx, buttons, boxX, boxY, dollW, inventory);
    const totalsBottom = this.renderTotals(ctx, boxX, boxY, dollW, doll, inventory);
    this.renderRefusal(ctx, boxX, totalsBottom, dollW);

    this.search.render(ctx, bagX, boxY + HEADER_ROW_Y, bagW, HEADER_ROW_H);
    const bag = this.renderBag(ctx, buttons, bagX, boxY, bagW, inventory);
    this.renderBagFooter(ctx, buttons, bagX, boxY, bagW, bag.bagCellSize, inventory);

    this.layout = { ...doll, ...bag };

    addButton(ctx, buttons, {
      x: boxX + EQUIP_PANEL_PAD,
      y: boxY + boxH - BACK_BUTTON_H - BACK_BUTTON_BOTTOM_MARGIN,
      width: boxW - EQUIP_PANEL_PAD * 2,
      height: BACK_BUTTON_H,
      label: 'Back',
      ...BUTTON_PRESETS.primary,
      primaryAction: true,
      action: () => setTab('game'),
    });

    this.renderHover(ctx, inventory);
    this.renderDragGhost(ctx);
    this.renderContextMenu(ctx, buttons, inventory);
    this.renderDescriptionTooltip(ctx);
  }

  private renderCrawlerToggles(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    boxX: number,
    boxY: number,
    dollW: number,
  ): void {
    const buttonW = Math.floor((dollW - EQUIP_PANEL_PAD * 2 - HEADER_BUTTON_GAP) / 2);
    let x = boxX + EQUIP_PANEL_PAD;
    for (const kind of CRAWLER_ORDER) {
      const selected = this.side === kind;
      addButton(ctx, buttons, {
        x,
        y: boxY + HEADER_ROW_Y,
        width: buttonW,
        height: HEADER_ROW_H,
        label: CRAWLER_LABELS[kind],
        ...(selected ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
        action: () => this.selectCrawler(kind),
      });
      x += buttonW + HEADER_BUTTON_GAP;
    }
  }

  private renderDoll(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    boxX: number,
    boxY: number,
    dollW: number,
    inventory: Inventory,
  ): Pick<EquipmentLayout, 'slotInfos' | 'slotSize'> {
    const cellsUsableW =
      dollW -
      EQUIP_PANEL_PAD * 2 -
      EQUIP_SECTION_LABEL_W -
      (DOLL_MAX_CELLS_PER_ROW - 1) * EQUIPMENT_SLOT_GAP;
    const slotSize = Math.max(
      EQUIPMENT_SLOT_MIN_SIZE,
      Math.min(EQUIPMENT_SLOT_SIZE, Math.floor(cellsUsableW / DOLL_MAX_CELLS_PER_ROW)),
    );
    const startY = boxY + CONTENT_TOP_Y;
    const slotInfos = buildEquipSlotInfos(boxX, startY, dollW, slotSize, EQUIPMENT_SLOT_GAP);

    for (const slot of EQUIP_SLOT_ORDER) {
      drawText(ctx, slot.toUpperCase(), {
        x: boxX + EQUIP_PANEL_PAD,
        y:
          equipSectionTopY(slotInfos, slot, startY) +
          slotSize * SECTION_LABEL_Y_FRACTION -
          SECTION_LABEL_BASELINE_LIFT,
        size: SECTION_LABEL_SIZE,
        bold: true,
        color: SECTION_LABEL_COLOR,
      });
    }

    // While a piece of gear is in hand — lifted from the bag or off another
    // slot — every sub-slot answers "can this take it?" instead of its usual
    // worn/empty/filtered look, the same way the hotbar marks the slots a
    // dragged item cannot join.
    const draggedItem = this.drag?.item ?? null;

    for (const info of slotInfos) {
      const liftedByDrag = this.drag?.origin === 'slot' && this.drag.key === info.key;
      const worn = liftedByDrag ? null : inventory.getEquippedItem(info.key);
      const isDragTarget =
        draggedItem !== null && this.slotFitRefusal(draggedItem, info.key) === null;
      const preset =
        draggedItem !== null
          ? isDragTarget
            ? BUTTON_PRESETS.equipSlotDragTarget
            : worn !== null
              ? BUTTON_PRESETS.equipSlotFilled
              : BUTTON_PRESETS.equipSlotEmpty
          : this.filterKey === info.key
            ? BUTTON_PRESETS.equipSlotFiltering
            : worn !== null
              ? BUTTON_PRESETS.equipSlotFilled
              : BUTTON_PRESETS.equipSlotEmpty;

      addButton(ctx, buttons, {
        x: info.x,
        y: info.y,
        width: slotSize,
        height: slotSize,
        label: '',
        ...preset,
        action: () => this.activateSlot(info.key, inventory),
      });

      if (worn !== null) {
        InventoryPanel.renderItemIcon(
          ctx,
          worn,
          info.x + ICON_INSET,
          info.y + ICON_INSET,
          slotSize - ICON_INSET * 2,
          1,
        );
      }

      // Word-wrapped rather than truncated, so a name like "Knee Pads" or "Toe
      // Ring 1" breaks onto a second line instead of spilling past the cell's
      // edge into whatever sits beside it.
      drawText(ctx, info.subSlot, {
        x: info.x + SUBSLOT_LABEL_SIDE_PAD,
        y: info.y + slotSize - SUBSLOT_LABEL_BLOCK_H - SUBSLOT_LABEL_BOTTOM_PAD,
        ...TEXT_PRESETS.label,
        size: SUBSLOT_LABEL_SIZE,
        lineHeight: SUBSLOT_LABEL_LINE_HEIGHT,
        width: slotSize - SUBSLOT_LABEL_SIDE_PAD * 2,
        align: 'center',
      });

      if (draggedItem !== null && !isDragTarget) {
        this.renderDenyMark(ctx, { x: info.x, y: info.y, w: slotSize, h: slotSize });
      }
    }

    return { slotInfos, slotSize };
  }

  /** Draws the worn-gear summary under the doll and returns the y it ended at. */
  private renderTotals(
    ctx: CanvasRenderingContext2D,
    boxX: number,
    boxY: number,
    dollW: number,
    doll: Pick<EquipmentLayout, 'slotInfos' | 'slotSize'>,
    inventory: Inventory,
  ): number {
    const lines = summariseWornGear(inventory);
    const shown = lines.slice(0, TOTALS_MAX_LINES);
    if (lines.length > TOTALS_MAX_LINES) shown.push(TOTALS_OVERFLOW_LINE);

    let y =
      equipLayoutBottomY(doll.slotInfos, doll.slotSize, boxY + CONTENT_TOP_Y) + TOTALS_GAP_ABOVE;
    for (const line of shown) {
      // lineHeight and height set to the same value keeps each summary to one
      // line with its descenders intact, however long the line runs.
      drawText(ctx, line, {
        x: boxX + EQUIP_PANEL_PAD,
        y,
        size: TOTALS_SIZE,
        color: TOTALS_COLOR,
        width: dollW - EQUIP_PANEL_PAD * 2,
        lineHeight: TOTALS_LINE_HEIGHT,
        height: TOTALS_LINE_HEIGHT,
      });
      y += TOTALS_LINE_HEIGHT;
    }
    return y;
  }

  private renderRefusal(
    ctx: CanvasRenderingContext2D,
    boxX: number,
    y: number,
    dollW: number,
  ): void {
    const message = this.refusal;
    if (message === null) return;
    drawText(ctx, message, {
      x: boxX + EQUIP_PANEL_PAD,
      y: y + TOTALS_GAP_ABOVE,
      ...TEXT_PRESETS.danger,
      size: REFUSAL_SIZE,
      width: dollW - EQUIP_PANEL_PAD * 2,
    });
  }

  private renderBag(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    bagX: number,
    boxY: number,
    bagW: number,
    inventory: Inventory,
  ): Pick<EquipmentLayout, 'bagCells' | 'bagCellSize'> {
    const usableW = bagW - (BAG_COLS - 1) * BAG_CELL_GAP;
    const bagCellSize = Math.max(
      BAG_CELL_MIN_SIZE,
      Math.min(BAG_CELL_SIZE, Math.floor(usableW / BAG_COLS)),
    );
    const gridW = BAG_COLS * bagCellSize + (BAG_COLS - 1) * BAG_CELL_GAP;
    const startX = bagX + Math.floor((bagW - gridW) / 2);
    const startY = boxY + CONTENT_TOP_Y;

    const wearableSlots = this.wearableBagSlotIndices(inventory);
    const bagCells: BagCell[] = [];
    const pageStart = this.page * SLOTS_PER_PAGE;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      if (pageStart + i >= wearableSlots.length) break;
      const slotIdx = wearableSlots[pageStart + i];
      const x = startX + (i % BAG_COLS) * (bagCellSize + BAG_CELL_GAP);
      const y = startY + Math.floor(i / BAG_COLS) * (bagCellSize + BAG_CELL_GAP);
      bagCells.push({ slotIdx, x, y });

      const liftedByDrag = this.drag?.origin === 'bag' && this.drag.slotIdx === slotIdx;
      const item = liftedByDrag ? null : inventory.bag.slots[slotIdx];
      const eligible = item !== null && this.bagItemIsEligible(item, inventory);
      // A search mismatch means the item isn't meant to be found right now, so
      // it stays inert. Everything else that's merely refused (already worn,
      // wrong wearer, doesn't fit the slot being filtered on) still taps —
      // `equipFromBag` answers with a refusal message instead of silently
      // doing nothing, which is what made those cells feel unresponsive.
      const tappable = item !== null && this.matchesSearch(item);

      const cell = {
        x,
        y,
        width: bagCellSize,
        height: bagCellSize,
        label: '',
        ...(eligible ? BUTTON_PRESETS.bagCellEligible : BUTTON_PRESETS.bagCell),
      };
      // `disabled` only governs how a button looks and whether it joins the
      // focus ring — `addButton` registers its action either way. So a cell
      // nobody can act on is never registered at all, which is what lets a click
      // on it fall through to the panel's own "nothing was hit" handling and
      // close the sub-slot filter. A cell under an open context menu is inert
      // the same way, so a click past the menu's edge cannot also equip.
      if (tappable && this.contextMenu === null) {
        addButton(ctx, buttons, {
          ...cell,
          action: () => this.equipFromBag(slotIdx, this.filterKey, inventory),
        });
      } else {
        drawButton(ctx, { ...cell, disabled: true });
      }

      if (item !== null) {
        ctx.save();
        if (!eligible) ctx.globalAlpha = CELL_INERT_ALPHA;
        InventoryPanel.renderItemIcon(
          ctx,
          item,
          x + ICON_INSET,
          y + ICON_INSET,
          bagCellSize - ICON_INSET * 2,
          1,
        );
        ctx.restore();
      }
    }

    return { bagCells, bagCellSize };
  }

  private renderBagFooter(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    bagX: number,
    boxY: number,
    bagW: number,
    bagCellSize: number,
    inventory: Inventory,
  ): void {
    const navY =
      boxY + CONTENT_TOP_Y + BAG_ROWS * bagCellSize + (BAG_ROWS - 1) * BAG_CELL_GAP + NAV_ROW_GAP;
    const pages = pageCount(this.wearableBagSlotIndices(inventory).length);
    // Prev/Next split the full row between them, and the page count sits on its
    // own line beneath — a label squeezed into the gap between two buttons
    // outgrows that gap on a narrow bag column and overlaps one of them.
    const navButtonW = Math.max(1, Math.floor((bagW - NAV_BUTTON_GAP) / 2));

    addButton(ctx, buttons, {
      x: bagX,
      y: navY,
      width: navButtonW,
      height: NAV_ROW_H,
      label: '< Prev',
      ...BUTTON_PRESETS.primary,
      labelSize: NAV_LABEL_SIZE,
      disabled: this.page === 0,
      action: () => {
        this.page = Math.max(0, this.page - 1);
      },
    });

    addButton(ctx, buttons, {
      x: bagX + bagW - navButtonW,
      y: navY,
      width: navButtonW,
      height: NAV_ROW_H,
      label: 'Next >',
      ...BUTTON_PRESETS.primary,
      labelSize: NAV_LABEL_SIZE,
      disabled: this.page >= pages - 1,
      action: () => {
        this.page = Math.min(pages - 1, this.page + 1);
      },
    });

    const pageLabelY = navY + NAV_ROW_H + PAGE_LABEL_GAP;
    drawText(ctx, `${this.page + 1} / ${pages}`, {
      x: bagX + bagW / 2,
      y: pageLabelY,
      size: NAV_LABEL_SIZE,
      color: '#64748b',
      align: 'center',
    });

    const filterKey = this.filterKey;
    const hint =
      filterKey === null
        ? 'Click a worn item to take it off, or an empty slot to see what fits.'
        : `Showing what fits ${keySubSlot(filterKey)}. Click that slot again to stop.`;
    drawText(ctx, hint, {
      x: bagX,
      y: pageLabelY + PAGE_LABEL_LINE_H + HINT_GAP,
      ...TEXT_PRESETS.controls,
      size: HINT_SIZE,
      width: bagW,
    });
  }

  private renderHover(ctx: CanvasRenderingContext2D, inventory: Inventory): void {
    if (this.drag !== null || this.contextMenu !== null || this.descriptionItem !== null) return;

    const hoverKey = this.hoverKey;
    if (hoverKey !== null) {
      const worn = inventory.getEquippedItem(hoverKey);
      if (worn !== null) {
        drawItemTooltip(ctx, worn, this.pointerX, this.pointerY, TOOLTIP_UNEQUIP_FOOTER);
      }
      return;
    }

    const hoverBagIdx = this.hoverBagIdx;
    if (hoverBagIdx === null) return;
    const item = inventory.bag.slots[hoverBagIdx];
    if (!item) return;
    const footer = this.bagItemIsEligible(item, inventory) ? TOOLTIP_EQUIP_FOOTER : null;
    drawItemTooltip(ctx, item, this.pointerX, this.pointerY, footer);
  }

  private renderDragGhost(ctx: CanvasRenderingContext2D): void {
    const drag = this.drag;
    if (drag?.moved !== true) return;
    ctx.save();
    ctx.globalAlpha = DRAG_GHOST_ALPHA;
    InventoryPanel.renderItemIcon(
      ctx,
      drag.item,
      drag.mx - DRAG_GHOST_SIZE / 2,
      drag.my - DRAG_GHOST_SIZE / 2,
      DRAG_GHOST_SIZE,
      1,
    );
    ctx.restore();
  }

  /** The circle-and-bar "no" laid over a doll slot that refuses the drag. */
  private renderDenyMark(
    ctx: CanvasRenderingContext2D,
    slot: { x: number; y: number; w: number; h: number },
  ): void {
    const centerX = slot.x + slot.w / 2;
    const centerY = slot.y + slot.h / 2;
    const radius = Math.min(slot.w, slot.h) * DENY_MARK_RADIUS_FRACTION;

    ctx.save();
    ctx.globalAlpha = DENY_MARK_ALPHA;
    ctx.strokeStyle = DENY_MARK_COLOR;
    ctx.lineWidth = DENY_MARK_BAR_WIDTH;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    const barDx = Math.cos(DENY_MARK_BAR_ANGLE) * radius;
    const barDy = Math.sin(DENY_MARK_BAR_ANGLE) * radius;
    ctx.beginPath();
    ctx.moveTo(centerX - barDx, centerY + barDy);
    ctx.lineTo(centerX + barDx, centerY - barDy);
    ctx.stroke();

    ctx.restore();
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  handleMouseDown(mx: number, my: number, human: HumanPlayer, cat: CatPlayer): void {
    this.pointerX = mx;
    this.pointerY = my;
    const layout = this.layout;
    if (layout === null) return;
    const inventory = this.selectedPlayer(human, cat).inventory;

    const key = equipSlotKeyAt(mx, my, layout.slotInfos, layout.slotSize);
    if (key !== null) {
      const worn = inventory.getEquippedItem(key);
      if (worn !== null) {
        this.drag = {
          origin: 'slot',
          key,
          item: worn,
          mx,
          my,
          startX: mx,
          startY: my,
          moved: false,
        };
      }
      return;
    }

    const cell = this.bagCellAt(mx, my, layout);
    if (cell === null) return;
    const item = inventory.bag.slots[cell.slotIdx];
    // A slot the query has filtered out is inert to every kind of press, exactly
    // as it is in the bag panel: dimmed means "not here", not "try harder".
    if (!item || !this.matchesSearch(item)) return;
    this.drag = {
      origin: 'bag',
      slotIdx: cell.slotIdx,
      item,
      mx,
      my,
      startX: mx,
      startY: my,
      moved: false,
    };
    this.startPressTimer(cell.slotIdx, item, mx, my);
  }

  handleMouseMove(mx: number, my: number): void {
    this.pointerX = mx;
    this.pointerY = my;
    const layout = this.layout;
    if (layout === null) return;

    const drag = this.drag;
    if (drag !== null) {
      drag.mx = mx;
      drag.my = my;
      if (Math.hypot(mx - drag.startX, my - drag.startY) > DRAG_SLOP_PX) {
        drag.moved = true;
        this.clearPressTimer();
      }
      return;
    }

    this.hoverKey = equipSlotKeyAt(mx, my, layout.slotInfos, layout.slotSize);
    this.hoverBagIdx =
      this.hoverKey === null ? (this.bagCellAt(mx, my, layout)?.slotIdx ?? null) : null;
  }

  handleMouseUp(mx: number, my: number, human: HumanPlayer, cat: CatPlayer): void {
    this.clearPressTimer();
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return;
    // A press that never travelled is a click, and clicks are answered by the
    // click handler — resolving it here as well would act twice.
    if (!drag.moved) return;
    this.suppressNextClick = true;

    const layout = this.layout;
    if (layout === null) return;
    const player = this.selectedPlayer(human, cat);
    const inventory = player.inventory;
    const targetKey = equipSlotKeyAt(mx, my, layout.slotInfos, layout.slotSize);

    if (drag.origin === 'bag') {
      // Dropped on open ground rather than on a slot: the item springs home,
      // which is what "never mind" looks like and does not deserve a refusal.
      if (targetKey !== null) this.equipFromBag(drag.slotIdx, targetKey, inventory);
      return;
    }

    if (targetKey === drag.key) return;
    // Judged before anything is taken off, so a refused drop leaves the piece
    // worn exactly as it was. `refusalFor` cannot answer this one: the item is
    // still on, so it would report itself as already worn.
    if (targetKey !== null) {
      const refusal = this.slotFitRefusal(drag.item, targetKey);
      if (refusal !== null) {
        this.refuse(refusal);
        return;
      }
    }
    inventory.unequip(drag.key);
    if (targetKey !== null) inventory.equipment.equip(drag.item, targetKey);
    player.onEquipmentChanged();
    this.filterKey = null;
  }

  /**
   * Answered before the button loop, because the search field is not a button
   * and a click anywhere else has to release the keyboard it is holding.
   *
   * Returns true when the click belongs to this tab alone and the buttons must
   * not also see it.
   */
  handleClickBefore(mx: number, my: number): boolean {
    // A pinned description is "shown until the next click" — cleared here so
    // any click reaching this tab dismisses it, not only one that misses
    // every button. A click that also lands on a button still acts normally;
    // this only stops the tooltip from outliving the click that follows it.
    this.descriptionItem = null;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return true;
    }
    if (this.search.hits(mx, my)) {
      this.search.focus();
      return true;
    }
    this.search.blur();
    return false;
  }

  /**
   * Forget the click a release was holding back. A touch drag ends without the
   * browser ever sending the click that `handleClickBefore` would have eaten, so
   * a scene that ends a drag with no click of its own has to say so — otherwise
   * the suppression waits and swallows the player's next tap instead.
   */
  clearSuppressedClick(): void {
    this.suppressNextClick = false;
  }

  /** Nothing on the tab took the click, so the filter the bag is showing is over. */
  handleClickMissed(): void {
    this.filterKey = null;
    this.contextMenu = null;
    this.descriptionItem = null;
  }

  // ── Bag item context menu ────────────────────────────────────────────────

  /** Arms a timer that opens the pressed bag item's context menu if the press holds still. */
  private startPressTimer(slotIdx: number, item: InventoryItem, x: number, y: number): void {
    this.clearPressTimer();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.drag = null;
      this.suppressNextClick = true;
      this.contextMenu = { slotIdx, item, x, y };
    }, BAG_LONG_PRESS_MS);
  }

  private clearPressTimer(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  private renderContextMenu(
    ctx: CanvasRenderingContext2D,
    buttons: ButtonRect[],
    inventory: Inventory,
  ): void {
    const menu = this.contextMenu;
    if (menu === null) return;

    const equipped = inventory.isSlotEquipped(menu.slotIdx);
    const options = [
      equipped ? CONTEXT_OPTION_UNEQUIP : CONTEXT_OPTION_EQUIP,
      CONTEXT_OPTION_DESCRIPTION,
      CONTEXT_OPTION_CANCEL,
    ];
    const menuH = options.length * CONTEXT_MENU_OPTION_H + CONTEXT_MENU_PAD * 2;
    const x = Math.min(menu.x, viewportWidth() - CONTEXT_MENU_WIDTH - CONTEXT_MENU_SCREEN_MARGIN);
    const y = Math.min(menu.y, viewportHeight() - menuH - CONTEXT_MENU_SCREEN_MARGIN);

    drawBox(ctx, { x, y, width: CONTEXT_MENU_WIDTH, height: menuH, ...BOX_PRESETS.tooltip });

    options.forEach((label, i) => {
      addButton(ctx, buttons, {
        x: x + CONTEXT_MENU_PAD,
        y: y + CONTEXT_MENU_PAD + i * CONTEXT_MENU_OPTION_H,
        width: CONTEXT_MENU_WIDTH - CONTEXT_MENU_PAD * 2,
        height: CONTEXT_MENU_OPTION_H,
        label,
        labelSize: CONTEXT_MENU_LABEL_SIZE,
        ...BUTTON_PRESETS.primary,
        action: () => this.handleContextMenuOption(label, menu, inventory),
      });
    });
  }

  private handleContextMenuOption(
    label: string,
    menu: { slotIdx: number; item: InventoryItem; x: number; y: number },
    inventory: Inventory,
  ): void {
    this.contextMenu = null;
    switch (label) {
      case CONTEXT_OPTION_EQUIP:
        this.equipFromBag(menu.slotIdx, null, inventory);
        return;
      case CONTEXT_OPTION_UNEQUIP:
        inventory.unequipById(menu.item.id);
        this.owner?.onEquipmentChanged();
        return;
      case CONTEXT_OPTION_DESCRIPTION:
        this.descriptionItem = menu.item;
        return;
      default:
        return;
    }
  }

  private renderDescriptionTooltip(ctx: CanvasRenderingContext2D): void {
    const item = this.descriptionItem;
    if (item === null) return;
    drawItemTooltip(ctx, item, this.pointerX, this.pointerY, null);
  }

  // ── Equip / unequip ────────────────────────────────────────────────────────

  /**
   * Switches the doll and bag to `kind`'s gear, dropping any in-flight drag or
   * filter — the same reset a click on the crawler toggle does. Exposed so a
   * caller can land on this tab already pointed at a specific crawler (the
   * Inventory tab's "Manage X Equipment" buttons) instead of always opening on
   * whichever side was selected last.
   */
  selectCrawler(kind: CrawlerKind): void {
    this.side = kind;
    this.page = 0;
    this.filterKey = null;
    this.drag = null;
  }

  /**
   * A click straight on a sub-slot cell. Filled means take it off, empty means
   * "show me what fits" — the RuneScape reading, and the one that keeps a single
   * click unambiguous.
   */
  private activateSlot(key: string, inventory: Inventory): void {
    const worn = inventory.getEquippedItem(key);
    if (worn !== null) {
      inventory.unequip(key);
      this.owner?.onEquipmentChanged();
      this.filterKey = null;
      return;
    }
    this.filterKey = this.filterKey === key ? null : key;
  }

  private equipFromBag(slotIdx: number, targetKey: string | null, inventory: Inventory): void {
    const item = inventory.bag.slots[slotIdx];
    if (!item) return;
    // Re-asked here rather than trusted from the caller: a cell the query has
    // dimmed is inert to every route, and the query can change between the
    // frame that drew the cell and the event that acts on it.
    if (!this.matchesSearch(item)) return;
    const refusal = this.refusalFor(item, targetKey, inventory);
    if (refusal !== null) {
      this.refuse(refusal);
      return;
    }
    inventory.equip(slotIdx, targetKey ?? undefined);
    this.owner?.onEquipmentChanged();
    this.filterKey = null;
  }

  /**
   * Why this item cannot sit in `targetKey`, or null when it fits there. Says
   * nothing about whether it is already being worn, so it can also judge a piece
   * that is on its way from one sub-slot to another.
   */
  private slotFitRefusal(item: InventoryItem, targetKey: string): string | null {
    if (!isWearable(item)) return NOT_WEARABLE_REFUSAL;
    if (item.equipSlot !== keySlot(targetKey)) return WRONG_SLOT_REFUSAL;
    if (!itemFitsSubSlot(item, keySubSlot(targetKey))) return WRONG_SLOT_REFUSAL;
    return null;
  }

  /** Why this item cannot go into `targetKey`, or null when it can. */
  private refusalFor(
    item: InventoryItem,
    targetKey: string | null,
    inventory: Inventory,
  ): string | null {
    if (!isWearable(item)) return NOT_WEARABLE_REFUSAL;
    if (targetKey !== null) {
      const fitRefusal = this.slotFitRefusal(item, targetKey);
      if (fitRefusal !== null) return fitRefusal;
    }
    if (inventory.hasEquipped(item.id)) return ALREADY_WORN_REFUSAL;
    // Read before the guard, because `canEquip` is a type predicate: its false
    // branch narrows the item to `never` and the wearer with it.
    const wearer = item.wearer;
    if (!inventory.equipment.canEquip(item)) {
      return wearer === undefined
        ? NOT_WEARABLE_REFUSAL
        : `Only the ${CRAWLER_LABELS[wearer]} can wear that.`;
    }
    return null;
  }

  private refuse(message: string): void {
    this.refusal = message;
    this.refusalFramesLeft = REFUSAL_FRAMES;
    this.audio?.play(REFUSAL_SOUND);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  private selectedPlayer(human: HumanPlayer, cat: CatPlayer): HumanPlayer | CatPlayer {
    return this.side === 'human' ? human : cat;
  }

  /** Bag slot indices holding a wearable item, in bag order — everything else never shows here. */
  private wearableBagSlotIndices(inventory: Inventory): number[] {
    const indices: number[] = [];
    inventory.bag.slots.forEach((item, slotIdx) => {
      if (item !== null && isWearable(item)) indices.push(slotIdx);
    });
    return indices;
  }

  private matchesSearch(item: InventoryItem): boolean {
    const query = this.search.normalizedQuery();
    if (query.length === 0) return true;
    return item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
  }

  /** True when acting on this bag cell would actually put the item on right now. */
  private bagItemIsEligible(item: InventoryItem, inventory: Inventory): boolean {
    if (!this.matchesSearch(item)) return false;
    return this.refusalFor(item, this.filterKey, inventory) === null;
  }

  private bagCellAt(mx: number, my: number, layout: EquipmentLayout): BagCell | null {
    const size = layout.bagCellSize;
    for (const cell of layout.bagCells) {
      if (pointInRect(mx, my, { x: cell.x, y: cell.y, w: size, h: size })) return cell;
    }
    return null;
  }
}

/**
 * Draw the tab. Thin on purpose — every decision lives on the controller, which
 * is what `PauseMenu` resets and routes pointer events into.
 */
export function renderEquipmentTab(
  ctx: CanvasRenderingContext2D,
  controller: EquipmentTabController,
  buttons: ButtonRect[],
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
): void {
  controller.render(ctx, buttons, boxX, boxY, boxW, boxH, human, cat, setTab);
}
