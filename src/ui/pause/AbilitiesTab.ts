import type { AbilityManager, AbilityDef, AbilityId } from '../../core/AbilityManager';
import type { Inventory } from '../../core/Inventory';
import { HOTBAR_COUNT } from '../../core/ItemDefs';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText, measureTextBox } from '../TextBox';
import { drawBox, drawDivider, drawProgressBar, drawScrollbar } from '../Box';

// Layout constants
const SCROLL_SPEED_MULTIPLIER = 0.5;
const LIST_ROW_H = 54;
const LIST_HEADER_H = 82; // extra space for the Equipped Abilities button
const LIST_FOOTER_H = 48;
const SCROLLBAR_W = 6;
const EQ_SLOT_SIZE = 40;
const EQ_SLOT_GAP = 6;
const EQ_HEADER_H = 72;
const EQ_FOOTER_H = 44;
const DETAIL_PERK_ROW_H = 24;
const DETAIL_PERK_LINE_H = 12;
const DETAIL_PERK_VPAD = 5;

// UI positioning (list view)
const LIST_TITLE_Y_OFFSET = 22;
const LIST_TITLE_Y_ADJUST = 10;
const LIST_BUTTON_Y_OFFSET = 34;
const LIST_BUTTON_HEIGHT = 30;
const LIST_BUTTON_MARGIN = 32;
const ICON_SIZE_LIST = 36;
const ICON_MARGIN_LEFT = 16;
const TEXT_X_OFFSET_FROM_ICON = 10;
const OWNER_LABEL_X_OFFSET = 8;
const OWNER_LABEL_Y_OFFSET = 15;
const OWNER_LABEL_Y_ADJUST = 8;
const OWNER_LABEL_SIZE = 10;
const LEVEL_TEXT_Y_OFFSET = 30;
const LEVEL_TEXT_Y_ADJUST = 9;
const LEVEL_TEXT_SIZE = 11;
const BAR_H_LIST = 6;
const BAR_Y_OFFSET = 38;
const BACK_BUTTON_Y_OFFSET = 7;
const BACK_BUTTON_HEIGHT = 34;
const BACK_BUTTON_MARGIN = 40;

// UI positioning (equipped abilities view)
const EQUIPPED_TITLE_Y_OFFSET = 22;
const EQUIPPED_TITLE_Y_ADJUST = 10;
const EQUIPPED_TITLE_SIZE = 15;
const TOGGLE_Y_OFFSET = 34;
const TOGGLE_W_DIVISOR = 2;
const TOGGLE_H = 24;
const TOGGLE_MARGIN = 16;
const TOGGLE_MARGIN_2 = 24;
const HOTBAR_LABEL_Y_OFFSET = 12;
const HOTBAR_LABEL_Y_ADJUST = 8;
const HOTBAR_LABEL_SIZE = 11;
const SLOT_ROW_Y_OFFSET = 18;
const SLOT_LABEL_OFFSET = 4;
const SLOT_LABEL_Y_OFFSET = 9;
const SLOT_LABEL_Y_ADJUST = 7;
const SLOT_LABEL_SIZE = 8;
const ICON_PAD_SLOT = 4;
const TOOLTIP_PAD = 6;
const TOOLTIP_H = 20;
const TOOLTIP_X_OFFSET = 8;
const TOOLTIP_Y_OFFSET = 4;
const REMOVE_BUTTON_Y_OFFSET = 3;
const REMOVE_BUTTON_HEIGHT = 16;
const REMOVE_BUTTON_LABEL_SIZE = 10;
const ITEM_INDICATOR_OFFSET = 6;
const ITEM_INDICATOR_TEXT_Y_OFFSET = 4;
const ITEM_INDICATOR_TEXT_SIZE = 8;
const AVAIL_SECTION_Y_OFFSET = 26;
const ADD_BUTTON_Y_OFFSET = 3;
const ADD_BUTTON_HEIGHT = 16;
const ADD_BUTTON_LABEL_SIZE = 9;
const TOOLTIP_TEXT_Y_OFFSET = 5;

// UI positioning (detail view)
const DETAIL_TITLE_Y_OFFSET = 24;
const DETAIL_TITLE_Y_ADJUST = 12;
const DETAIL_TITLE_SIZE = 15;
const DETAIL_OWNER_Y_OFFSET = 38;
const DETAIL_OWNER_Y_ADJUST = 9;
const DETAIL_OWNER_SIZE = 11;
const DETAIL_EQUIP_Y_OFFSET = 50;
const DETAIL_EQUIP_Y_ADJUST = 8;
const DETAIL_EQUIP_SIZE = 10;
const DETAIL_EQUIP_H_PAD = 16;
const DETAIL_CONTENT_Y_OFFSET = 64;
const DETAIL_LEVEL_Y_ADJUST = 10;
const DETAIL_LEVEL_SIZE = 12;
const DETAIL_LEVEL_SPACING = 14;
const DETAIL_BAR_X_OFFSET = 16;
const DETAIL_BAR_H = 8;
const DETAIL_BAR_SPACING = 14;
const DETAIL_XP_SIZE = 10;
const DETAIL_DIVIDER_X_OFFSET = 16;
const DETAIL_DIVIDER_LENGTH_MARGIN = 32;
const DETAIL_DIVIDER_Y_OFFSET = 10;
const PERK_HEADING_Y_OFFSET = 9;
const PERK_HEADING_SIZE = 11;
const PERK_HEADING_Y_SPACING = 14;
const PERK_AREA_BACK_BTN_H = 44;
const DESC_MAX_W_OFFSET = 44;
const PERK_LEVEL_BADGE_W = 22;
const PERK_LEVEL_BADGE_H = 18;
const PERK_LEVEL_BADGE_X_OFFSET = 10;
const PERK_LEVEL_BADGE_CENTER_X = 21;
const PERK_DESC_X_OFFSET = 38;
const PERK_DESC_FIRST_LINE_TOP_OFFSET = DETAIL_PERK_VPAD;
const PERK_DESC_SIZE = 10;
const SCROLL_HINT_Y_OFFSET = 4;
const SCROLL_HINT_Y_ADJUST = 7;
const SCROLL_HINT_SIZE = 9;
const SCROLL_HINT_X_OFFSET = 2;

// Colors
const TOOLTIP_BG_COLOR = 'rgba(15,23,42,0.95)';
const TOOLTIP_BORDER_COLOR = '#7c3aed';

// Additional layout constants
const ICON_Y_OFFSET_LIST = 2;
const TITLE_Y_OFFSET_LIST = 16;
const DETAILS_BUTTON_WIDTH = 88;
const DETAILS_BUTTON_X_OFFSET = 12;
const DETAILS_BUTTON_Y_OFFSET = 4;
const DETAILS_BUTTON_H = 32;
const NO_ABILITIES_Y_OFFSET = 20;
const HUMAN_TOGGLE_LABEL_Y_OFFSET = 15;
const CAT_TOGGLE_LABEL_Y_OFFSET = 15;
const DETAIL_SLOT_ICON_PAD = 4;
const DETAIL_ITEM_INDICATOR_W_MARGIN = 12;
const DETAIL_ITEM_INDICATOR_H_MARGIN = 12;
const BUTTON_X_MARGIN_LEFT = 20;
const BUTTON_X_MARGIN_RIGHT_CALC = 40;
const BACK_BTN_X = 20;
const BAR_WIDTH_MARGIN_1 = 90;
const BAR_WIDTH_MARGIN_2 = 4;
const AVAILABLE_SECTION_Y_PADDING = 20;
const PERK_NEW_BOX_X_OFFSET = 4;
const PERK_NEW_BOX_Y_OFFSET = 2;
const PERK_NEW_BOX_WIDTH_MARGIN = 8;
const PERK_AREA_BACK_BTN_Y_OFFSET = 6;

// Additional magic numbers
const TOOLTIP_DRAW_Y_OFFSET = 16;
const TOGGLE_W_WIDTH_MARGIN = 40;
const PERK_BADGE_CENTER_Y_OFFSET = 13;
const DESC_MAX_W_SCROLLBAR_MARGIN = 4;

function isAbilityId(id: string): id is AbilityId {
  const ABILITY_IDS: ReadonlyArray<string> = ['magic_missile', 'protective_shell'];
  return ABILITY_IDS.includes(id);
}

type AbilitiesView = 'list' | 'equipped_abilities' | AbilityId;

let currentView: AbilitiesView = 'list';
let equippedPlayer: 'human' | 'cat' = 'cat';

// Scroll state — owned here, updated each render frame
let listScrollY = 0;
let detailScrollY = 0;
let listContentH = 0;
let listViewportH = 0;
let detailContentH = 0;
let detailViewportH = 0;

// Touch scroll tracking
let touchStartY: number | null = null;
let touchScrollBase = 0;

export function resetAbilitiesTab(): void {
  currentView = 'list';
  listScrollY = 0;
  detailScrollY = 0;
  touchStartY = null;
}

export function scrollAbilitiesTab(deltaY: number): void {
  if (currentView === 'list') {
    const maxScroll = Math.max(0, listContentH - listViewportH);
    listScrollY = Math.max(0, Math.min(maxScroll, listScrollY + deltaY * SCROLL_SPEED_MULTIPLIER));
  } else {
    const maxScroll = Math.max(0, detailContentH - detailViewportH);
    detailScrollY = Math.max(
      0,
      Math.min(maxScroll, detailScrollY + deltaY * SCROLL_SPEED_MULTIPLIER),
    );
  }
}

export function abilitiesTabTouchStart(y: number): void {
  touchStartY = y;
  touchScrollBase = currentView === 'list' ? listScrollY : detailScrollY;
}

export function abilitiesTabTouchMove(y: number): void {
  if (touchStartY === null) return;
  const delta = touchStartY - y;
  const newScroll = touchScrollBase + delta;
  if (currentView === 'list') {
    const maxScroll = Math.max(0, listContentH - listViewportH);
    listScrollY = Math.max(0, Math.min(maxScroll, newScroll));
  } else {
    const maxScroll = Math.max(0, detailContentH - detailViewportH);
    detailScrollY = Math.max(0, Math.min(maxScroll, newScroll));
  }
}

export function abilitiesTabTouchEnd(): void {
  touchStartY = null;
}

export function renderAbilitiesTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  abilityManager: AbilityManager,
  humanInventory?: Inventory,
  catInventory?: Inventory,
  mouseX?: number,
  mouseY?: number,
): void {
  if (currentView === 'list') {
    renderListView(ctx, buttons, bx, by, bw, bh, setTab, abilityManager);
  } else if (currentView === 'equipped_abilities') {
    renderEquippedAbilitiesView(
      ctx,
      buttons,
      bx,
      by,
      bw,
      bh,
      abilityManager,
      humanInventory,
      catInventory,
      mouseX,
      mouseY,
    );
  } else {
    const def = abilityManager.getDef(currentView);
    if (def) {
      renderDetailView(ctx, buttons, bx, by, bw, bh, def, abilityManager);
    } else {
      currentView = 'list';
      renderListView(ctx, buttons, bx, by, bw, bh, setTab, abilityManager);
    }
  }
}

function renderListView(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  abilityManager: AbilityManager,
): void {
  drawText(ctx, 'Abilities Unlocked', {
    x: bx + bw / 2,
    y: by + LIST_TITLE_Y_OFFSET - LIST_TITLE_Y_ADJUST,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

  addButton(ctx, buttons, {
    x: bx + ICON_MARGIN_LEFT,
    y: by + LIST_BUTTON_Y_OFFSET,
    width: bw - LIST_BUTTON_MARGIN,
    height: LIST_BUTTON_HEIGHT,
    label: 'Equipped Abilities ▶',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'equipped_abilities';
    },
  });

  const abilities = abilityManager.getAllRegistered();
  const listAreaTop = by + LIST_HEADER_H;
  const areaH = bh - LIST_HEADER_H - LIST_FOOTER_H;
  listViewportH = areaH;
  listContentH = abilities.length * LIST_ROW_H;

  if (abilities.length === 0) {
    drawText(ctx, 'No abilities unlocked yet.', {
      x: bx + bw / TOGGLE_W_DIVISOR,
      y: listAreaTop + NO_ABILITIES_Y_OFFSET - LIST_TITLE_Y_ADJUST,
      size: 13,
      color: '#64748b',
      align: 'center',
    });
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, listAreaTop, bw, areaH);
    ctx.clip();

    let rowY = listAreaTop - listScrollY;
    for (const def of abilities) {
      const state = abilityManager.getState(def.id);
      if (!state) {
        rowY += LIST_ROW_H;
        continue;
      }

      const visible = rowY + LIST_ROW_H > listAreaTop && rowY < listAreaTop + areaH;

      const iconSize = ICON_SIZE_LIST;
      const iconX = bx + ICON_MARGIN_LEFT;
      def.renderIcon(ctx, iconX, rowY + ICON_Y_OFFSET_LIST, iconSize, state.level);

      const textX = iconX + iconSize + TEXT_X_OFFSET_FROM_ICON;
      drawText(ctx, def.name, {
        x: textX,
        y: rowY + TITLE_Y_OFFSET_LIST - LIST_TITLE_Y_ADJUST,
        bold: true,
        size: 13,
        color: '#e2e8f0',
      });

      const ownerLabel = state.owner === 'cat' ? 'Cat' : 'Human';
      const ownerColor = state.owner === 'cat' ? '#38bdf8' : '#fb923c';

      // Measure name width at bold 13px to position ownerLabel after it
      ctx.save();
      ctx.font = 'bold 13px monospace';
      const nameWidth = ctx.measureText(def.name).width;
      ctx.restore();

      drawText(ctx, ownerLabel, {
        x: textX + nameWidth + OWNER_LABEL_X_OFFSET,
        y: rowY + OWNER_LABEL_Y_OFFSET - OWNER_LABEL_Y_ADJUST,
        bold: true,
        size: OWNER_LABEL_SIZE,
        color: ownerColor,
      });
      drawText(ctx, `Level ${state.level} / ${def.maxLevel}`, {
        x: textX,
        y: rowY + LEVEL_TEXT_Y_OFFSET - LEVEL_TEXT_Y_ADJUST,
        size: LEVEL_TEXT_SIZE,
        color: '#94a3b8',
      });

      const barX = textX;
      const barW = bw - iconSize - BAR_WIDTH_MARGIN_1 - SCROLLBAR_W - BAR_WIDTH_MARGIN_2;
      const barH = BAR_H_LIST;
      const barY = rowY + BAR_Y_OFFSET;
      const xpFrac = state.xpToNextLevel === Infinity ? 1 : state.xp / state.xpToNextLevel;
      drawProgressBar(ctx, {
        x: barX,
        y: barY,
        width: barW,
        height: barH,
        value: Math.min(xpFrac, 1),
        fill: '#7c3aed',
        background: '#1e293b',
      });

      if (visible) {
        const btnW = DETAILS_BUTTON_WIDTH;
        const btnX = bx + bw - btnW - SCROLLBAR_W - DETAILS_BUTTON_X_OFFSET;
        const detailId = def.id;
        addButton(ctx, buttons, {
          x: btnX,
          y: rowY + DETAILS_BUTTON_Y_OFFSET,
          width: btnW,
          height: DETAILS_BUTTON_H,
          label: 'Details',
          ...BUTTON_PRESETS.primary,
          action: () => {
            currentView = detailId;
            detailScrollY = 0;
            touchStartY = null;
          },
        });
      }

      rowY += LIST_ROW_H;
    }

    ctx.restore();

    drawScrollbar(ctx, {
      x: bx + bw - SCROLLBAR_W - 2,
      trackY: listAreaTop,
      trackH: areaH,
      contentH: listContentH,
      scrollY: listScrollY,
      width: SCROLLBAR_W,
      thumbColor: '#7c3aed',
    });
  }

  const backY = by + bh - LIST_FOOTER_H + BACK_BUTTON_Y_OFFSET;
  addButton(ctx, buttons, {
    x: bx + BUTTON_X_MARGIN_LEFT,
    y: backY,
    width: bw - BUTTON_X_MARGIN_RIGHT_CALC,
    height: BACK_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'list';
      setTab('main');
    },
  });
}

// Tooltip helper

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bx: number,
  by: number,
  bw: number,
  _bh: number,
): void {
  ctx.save();
  ctx.font = 'bold 11px monospace';
  const tw = ctx.measureText(text).width;
  const pad = TOOLTIP_PAD;
  const ttW = tw + pad * 2;
  const ttH = TOOLTIP_H;
  let ttX = x + TOOLTIP_X_OFFSET;
  let ttY = y - ttH - TOOLTIP_Y_OFFSET;
  if (ttX + ttW > bx + bw) ttX = bx + bw - ttW - 2;
  if (ttY < by + 2) ttY = y + TOOLTIP_DRAW_Y_OFFSET;
  drawBox(ctx, {
    x: ttX,
    y: ttY,
    width: ttW,
    height: ttH,
    fill: TOOLTIP_BG_COLOR,
    border: TOOLTIP_BORDER_COLOR,
    borderWidth: 1,
  });
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(text, ttX + pad, ttY + ttH - TOOLTIP_TEXT_Y_OFFSET);
  ctx.restore();
}

// Equipped Abilities View

function renderEquippedAbilitiesView(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  abilityManager: AbilityManager,
  humanInventory: Inventory | undefined,
  catInventory: Inventory | undefined,
  mouseX: number | undefined,
  mouseY: number | undefined,
): void {
  // Header
  drawText(ctx, 'Equipped Abilities', {
    x: bx + bw / 2,
    y: by + EQUIPPED_TITLE_Y_OFFSET - EQUIPPED_TITLE_Y_ADJUST,
    bold: true,
    size: EQUIPPED_TITLE_SIZE,
    color: '#e9d5ff',
    align: 'center',
  });

  // Player toggle
  const toggleY = by + TOGGLE_Y_OFFSET;
  const toggleW = (bw - TOGGLE_W_WIDTH_MARGIN) / TOGGLE_W_DIVISOR;
  const humanColor = equippedPlayer === 'human' ? '#fb923c' : '#475569';
  const catColor = equippedPlayer === 'cat' ? '#38bdf8' : '#475569';

  drawBox(ctx, {
    x: bx + TOGGLE_MARGIN,
    y: toggleY,
    width: toggleW,
    height: TOGGLE_H,
    fill: equippedPlayer === 'human' ? 'rgba(251,146,60,0.18)' : 'rgba(30,41,59,0.6)',
  });
  drawText(ctx, 'Human', {
    x: bx + TOGGLE_MARGIN + toggleW / TOGGLE_W_DIVISOR,
    y: toggleY + HUMAN_TOGGLE_LABEL_Y_OFFSET - LIST_TITLE_Y_ADJUST,
    bold: equippedPlayer === 'human',
    size: 12,
    color: humanColor,
    align: 'center',
  });
  buttons.push({
    x: bx + TOGGLE_MARGIN,
    y: toggleY,
    w: toggleW,
    h: TOGGLE_H,
    action: () => {
      equippedPlayer = 'human';
    },
  });

  drawBox(ctx, {
    x: bx + TOGGLE_MARGIN_2 + toggleW,
    y: toggleY,
    width: toggleW,
    height: TOGGLE_H,
    fill: equippedPlayer === 'cat' ? 'rgba(56,189,248,0.18)' : 'rgba(30,41,59,0.6)',
  });
  drawText(ctx, 'Cat', {
    x: bx + TOGGLE_MARGIN_2 + toggleW + toggleW / TOGGLE_W_DIVISOR,
    y: toggleY + CAT_TOGGLE_LABEL_Y_OFFSET - LIST_TITLE_Y_ADJUST,
    bold: equippedPlayer === 'cat',
    size: 12,
    color: catColor,
    align: 'center',
  });
  buttons.push({
    x: bx + TOGGLE_MARGIN_2 + toggleW,
    y: toggleY,
    w: toggleW,
    h: TOGGLE_H,
    action: () => {
      equippedPlayer = 'cat';
    },
  });

  const inventory = equippedPlayer === 'human' ? humanInventory : catInventory;
  const contentY = by + EQ_HEADER_H;
  const contentH = bh - EQ_HEADER_H - EQ_FOOTER_H;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, contentY, bw, contentH);
  ctx.clip();

  //  Hotbar section
  drawText(ctx, 'Hotbar Abilities', {
    x: bx + ICON_MARGIN_LEFT,
    y: contentY + HOTBAR_LABEL_Y_OFFSET - HOTBAR_LABEL_Y_ADJUST,
    bold: true,
    size: HOTBAR_LABEL_SIZE,
    color: '#94a3b8',
  });

  const slotRowY = contentY + SLOT_ROW_Y_OFFSET;
  const totalSlots = HOTBAR_COUNT - 1; // exclude quest slot
  const rowW = totalSlots * (EQ_SLOT_SIZE + EQ_SLOT_GAP) - EQ_SLOT_GAP;
  const rowX = bx + (bw - rowW) / TOGGLE_W_DIVISOR;

  for (let i = 0; i < totalSlots; i++) {
    const sx = rowX + i * (EQ_SLOT_SIZE + EQ_SLOT_GAP);
    const sy = slotRowY;
    const slot = inventory?.actionBar.slots[i] ?? null;
    const isAbilityTome = slot !== null && slot.canDrop === false && slot.abilityId !== undefined;

    // Slot background
    drawBox(ctx, {
      x: sx,
      y: sy,
      width: EQ_SLOT_SIZE,
      height: EQ_SLOT_SIZE,
      fill: isAbilityTome ? 'rgba(124,58,237,0.25)' : 'rgba(30,41,59,0.7)',
      border: isAbilityTome ? '#7c3aed' : '#334155',
      borderWidth: 1.5,
    });

    // Slot label
    drawText(ctx, String(i + 1), {
      x: sx + SLOT_LABEL_OFFSET,
      y: sy + SLOT_LABEL_Y_OFFSET - SLOT_LABEL_Y_ADJUST,
      size: SLOT_LABEL_SIZE,
      color: '#64748b',
    });

    if (slot !== null) {
      if (isAbilityTome && slot.abilityId !== undefined && isAbilityId(slot.abilityId)) {
        const abilityIdTyped = slot.abilityId;
        const def = abilityManager.getDef(abilityIdTyped);
        if (def) {
          const iconPad = ICON_PAD_SLOT;
          const iconSize = EQ_SLOT_SIZE - iconPad * TOGGLE_W_DIVISOR;
          def.renderIcon(
            ctx,
            sx + iconPad,
            sy + iconPad,
            iconSize,
            abilityManager.getLevel(def.id),
          );

          // Hover tooltip
          if (
            mouseX !== undefined &&
            mouseY !== undefined &&
            mouseX >= sx &&
            mouseX <= sx + EQ_SLOT_SIZE &&
            mouseY >= sy &&
            mouseY <= sy + EQ_SLOT_SIZE
          ) {
            drawTooltip(ctx, def.name, mouseX, mouseY, bx, by, bw, bh);
          }

          // Remove button
          const rmY = sy + EQ_SLOT_SIZE + REMOVE_BUTTON_Y_OFFSET;
          const slotCapture = slot;
          addButton(ctx, buttons, {
            x: sx,
            y: rmY,
            width: EQ_SLOT_SIZE,
            height: REMOVE_BUTTON_HEIGHT,
            label: '✕',
            ...BUTTON_PRESETS.danger,
            labelSize: REMOVE_BUTTON_LABEL_SIZE,
            action: () => {
              if (!inventory) return;
              const emptyIdx = inventory.bag.slots.indexOf(null);
              if (emptyIdx !== -1) {
                inventory.bag.slots[emptyIdx] = slotCapture;
                inventory.actionBar.slots[i] = null;
              }
            },
          });
        }
      } else {
        // Non-ability item — show grayed indicator
        drawBox(ctx, {
          x: sx + ITEM_INDICATOR_OFFSET,
          y: sy + ITEM_INDICATOR_OFFSET,
          width: EQ_SLOT_SIZE - DETAIL_ITEM_INDICATOR_W_MARGIN,
          height: EQ_SLOT_SIZE - DETAIL_ITEM_INDICATOR_H_MARGIN,
          fill: 'rgba(100,116,139,0.35)',
        });
        drawText(ctx, 'item', {
          x: sx + EQ_SLOT_SIZE / TOGGLE_W_DIVISOR,
          y: sy + EQ_SLOT_SIZE / TOGGLE_W_DIVISOR + ITEM_INDICATOR_TEXT_Y_OFFSET,
          size: ITEM_INDICATOR_TEXT_SIZE,
          color: '#475569',
          align: 'center',
        });
      }
    }
  }

  // Available abilities section
  const availSectionY = slotRowY + EQ_SLOT_SIZE + AVAIL_SECTION_Y_OFFSET;
  drawText(ctx, 'Available Abilities', {
    x: bx + ICON_MARGIN_LEFT,
    y: availSectionY - LIST_TITLE_Y_ADJUST,
    bold: true,
    size: HOTBAR_LABEL_SIZE,
    color: '#94a3b8',
  });

  // Find ability tomes in the bag
  const bagTomes: Array<{ bagIdx: number; abilityId: AbilityId }> = [];
  if (inventory) {
    for (let i = 0; i < inventory.bag.slots.length; i++) {
      const s = inventory.bag.slots[i];
      if (
        s !== null &&
        s.canDrop === false &&
        s.abilityId !== undefined &&
        isAbilityId(s.abilityId)
      ) {
        bagTomes.push({ bagIdx: i, abilityId: s.abilityId });
      }
    }
  }

  if (bagTomes.length === 0) {
    drawText(ctx, 'No abilities in bag.', {
      x: bx + bw / TOGGLE_W_DIVISOR,
      y: availSectionY + AVAILABLE_SECTION_Y_PADDING,
      size: 11,
      color: '#475569',
      align: 'center',
    });
  } else {
    let availX = rowX;
    for (const { bagIdx, abilityId } of bagTomes) {
      const def = abilityManager.getDef(abilityId);
      if (!def) continue;
      const sy = availSectionY;

      drawBox(ctx, {
        x: availX,
        y: sy,
        width: EQ_SLOT_SIZE,
        height: EQ_SLOT_SIZE,
        fill: 'rgba(30,41,59,0.7)',
        border: '#334155',
        borderWidth: 1.5,
      });

      const iconPad = DETAIL_SLOT_ICON_PAD;
      def.renderIcon(
        ctx,
        availX + iconPad,
        sy + iconPad,
        EQ_SLOT_SIZE - iconPad * TOGGLE_W_DIVISOR,
        abilityManager.getLevel(def.id),
      );

      if (
        mouseX !== undefined &&
        mouseY !== undefined &&
        mouseX >= availX &&
        mouseX <= availX + EQ_SLOT_SIZE &&
        mouseY >= sy &&
        mouseY <= sy + EQ_SLOT_SIZE
      ) {
        drawTooltip(ctx, def.name, mouseX, mouseY, bx, by, bw, bh);
      }

      // Add button
      const addBtnY = sy + EQ_SLOT_SIZE + ADD_BUTTON_Y_OFFSET;
      const bagIdxCapture = bagIdx;
      addButton(ctx, buttons, {
        x: availX,
        y: addBtnY,
        width: EQ_SLOT_SIZE,
        height: ADD_BUTTON_HEIGHT,
        label: '+Add',
        ...BUTTON_PRESETS.success,
        labelSize: ADD_BUTTON_LABEL_SIZE,
        action: () => {
          if (!inventory) return;
          const bagItem = inventory.bag.slots[bagIdxCapture];
          if (!bagItem) return;
          // Find first empty or non-ability hotbar slot (excluding quest slot)
          let targetSlot = -1;
          for (let i = 0; i < HOTBAR_COUNT - 1; i++) {
            if (!inventory.actionBar.slots[i]) {
              targetSlot = i;
              break;
            }
          }
          if (targetSlot === -1) {
            // No empty slot — use slot 0, bumping any item to bag
            targetSlot = 0;
          }
          const displaced = inventory.actionBar.slots[targetSlot];
          if (displaced && displaced.canDrop !== false) {
            // Move displaced item to first empty bag slot
            const emptyBag = inventory.bag.slots.indexOf(null);
            if (emptyBag !== -1) {
              inventory.bag.slots[emptyBag] = displaced;
            }
          }
          inventory.actionBar.slots[targetSlot] = bagItem;
          inventory.bag.slots[bagIdxCapture] = null;
        },
      });

      availX += EQ_SLOT_SIZE + EQ_SLOT_GAP;
    }
  }

  ctx.restore();

  // Back button
  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X,
    y: by + bh - EQ_FOOTER_H + BACK_BUTTON_Y_OFFSET,
    width: bw - BACK_BUTTON_MARGIN,
    height: BACK_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'list';
      touchStartY = null;
    },
  });
}

function renderDetailView(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  def: AbilityDef,
  abilityManager: AbilityManager,
): void {
  const state = abilityManager.getState(def.id);
  if (!state) return;

  const currentLevel = state.level;

  // Title
  drawText(ctx, def.name, {
    x: bx + bw / TOGGLE_W_DIVISOR,
    y: by + DETAIL_TITLE_Y_OFFSET - DETAIL_TITLE_Y_ADJUST,
    bold: true,
    size: DETAIL_TITLE_SIZE,
    color: '#e9d5ff',
    align: 'center',
  });

  // Owner
  const ownerLabel = state.owner === 'cat' ? 'Cat' : 'Human';
  const ownerColor = state.owner === 'cat' ? '#38bdf8' : '#fb923c';
  drawText(ctx, `Owner: ${ownerLabel}`, {
    x: bx + bw / TOGGLE_W_DIVISOR,
    y: by + DETAIL_OWNER_Y_OFFSET - DETAIL_OWNER_Y_ADJUST,
    bold: true,
    size: DETAIL_OWNER_SIZE,
    color: ownerColor,
    align: 'center',
  });

  // Equip instructions
  drawText(ctx, `How to equip: ${def.equipInstructions}`, {
    x: bx + DETAIL_EQUIP_H_PAD,
    y: by + DETAIL_EQUIP_Y_OFFSET - DETAIL_EQUIP_Y_ADJUST,
    size: DETAIL_EQUIP_SIZE,
    color: '#64748b',
    align: 'center',
    width: bw - DETAIL_EQUIP_H_PAD * 2,
  });

  let y = by + DETAIL_CONTENT_Y_OFFSET;

  // Level + XP bar
  drawText(ctx, `Current level: ${currentLevel}`, {
    x: bx + DETAIL_BAR_X_OFFSET,
    y: y - DETAIL_LEVEL_Y_ADJUST,
    size: DETAIL_LEVEL_SIZE,
    color: '#94a3b8',
  });
  y += DETAIL_LEVEL_SPACING;

  const barX = bx + DETAIL_BAR_X_OFFSET;
  const barW = bw - DETAIL_DIVIDER_LENGTH_MARGIN;
  const barH = DETAIL_BAR_H;
  const xpFrac = state.xpToNextLevel === Infinity ? 1 : state.xp / state.xpToNextLevel;
  drawProgressBar(ctx, {
    x: barX,
    y,
    width: barW,
    height: barH,
    value: Math.min(xpFrac, 1),
    fill: '#7c3aed',
    background: '#1e293b',
  });
  y += barH + DETAIL_BAR_SPACING;

  if (currentLevel < def.maxLevel) {
    drawText(ctx, `XP to next level: ${state.xp} / ${state.xpToNextLevel}`, {
      x: bx + DETAIL_BAR_X_OFFSET,
      y: y - DETAIL_EQUIP_Y_ADJUST,
      size: DETAIL_XP_SIZE,
      color: '#64748b',
    });
  } else {
    drawText(ctx, 'MAX LEVEL', {
      x: bx + DETAIL_BAR_X_OFFSET,
      y: y - DETAIL_EQUIP_Y_ADJUST,
      bold: true,
      size: DETAIL_XP_SIZE,
      color: '#fbbf24',
    });
  }
  y += DETAIL_LEVEL_SPACING;

  // Separator
  drawDivider(ctx, {
    x: bx + DETAIL_DIVIDER_X_OFFSET,
    y,
    length: bw - DETAIL_DIVIDER_LENGTH_MARGIN,
    color: '#334155',
  });
  y += DETAIL_DIVIDER_Y_OFFSET;

  // Perks heading
  drawText(ctx, 'Level Perks:', {
    x: bx + DETAIL_BAR_X_OFFSET,
    y: y - PERK_HEADING_Y_OFFSET,
    bold: true,
    size: PERK_HEADING_SIZE,
    color: '#94a3b8',
  });
  y += PERK_HEADING_Y_SPACING;

  // Scrollable perks area
  const backBtnH = PERK_AREA_BACK_BTN_H;
  const perkAreaTop = y;
  const perkAreaH = bh - (perkAreaTop - by) - backBtnH;
  const descMaxW = bw - DESC_MAX_W_OFFSET - SCROLLBAR_W - DESC_MAX_W_SCROLLBAR_MARGIN;

  // Pre-pass: measure row heights for each perk using measureTextBox
  const perksLayout = def.perks.map((perk) => {
    const unlocked = currentLevel >= perk.level;
    const displayText = unlocked ? perk.description : '???';
    const { lineCount } = measureTextBox(ctx, displayText, {
      size: 10,
      bold: unlocked,
      width: descMaxW,
      lineHeight: DETAIL_PERK_LINE_H,
    });
    const rowH = Math.max(DETAIL_PERK_ROW_H, DETAIL_PERK_VPAD * 2 + lineCount * DETAIL_PERK_LINE_H);
    return { perk, rowH, unlocked, displayText };
  });

  detailViewportH = perkAreaH;
  detailContentH = perksLayout.reduce((sum, { rowH }) => sum + rowH, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, perkAreaTop, bw - SCROLLBAR_W - 2, perkAreaH);
  ctx.clip();

  let perkY = perkAreaTop - detailScrollY;
  for (const { perk, rowH, unlocked, displayText } of perksLayout) {
    const isNew = perk.level === currentLevel;

    if (isNew) {
      drawBox(ctx, {
        x: bx + PERK_NEW_BOX_X_OFFSET,
        y: perkY - PERK_NEW_BOX_Y_OFFSET,
        width: bw - PERK_NEW_BOX_WIDTH_MARGIN,
        height: rowH,
        fill: 'rgba(109,40,217,0.18)',
      });
    }

    // Level badge — vertically centered in row
    const badgeY = perkY + Math.floor((rowH - PERK_LEVEL_BADGE_H) / TOGGLE_W_DIVISOR);
    drawBox(ctx, {
      x: bx + PERK_LEVEL_BADGE_X_OFFSET,
      y: badgeY,
      width: PERK_LEVEL_BADGE_W,
      height: PERK_LEVEL_BADGE_H,
      fill: unlocked ? '#7c3aed' : '#334155',
    });
    drawText(ctx, String(perk.level), {
      x: bx + PERK_LEVEL_BADGE_CENTER_X,
      y: badgeY + PERK_BADGE_CENTER_Y_OFFSET - DETAIL_OWNER_Y_ADJUST,
      bold: true,
      size: DETAIL_XP_SIZE,
      color: unlocked ? '#ede9fe' : '#64748b',
      align: 'center',
    });

    // Description — word-wrapped via drawText
    const descX = bx + PERK_DESC_X_OFFSET;
    const firstLineTop = perkY + PERK_DESC_FIRST_LINE_TOP_OFFSET;
    drawText(ctx, displayText, {
      x: descX,
      y: firstLineTop,
      size: PERK_DESC_SIZE,
      bold: unlocked,
      color: unlocked ? '#e2e8f0' : '#475569',
      width: descMaxW,
      lineHeight: DETAIL_PERK_LINE_H,
    });

    perkY += rowH;
  }

  ctx.restore();

  // Scrollbar
  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_W - 2,
    trackY: perkAreaTop,
    trackH: perkAreaH,
    contentH: detailContentH,
    scrollY: detailScrollY,
    width: SCROLLBAR_W,
    thumbColor: '#7c3aed',
  });
  if (detailContentH > perkAreaH) {
    // Scroll hint
    if (detailScrollY === 0) {
      drawText(ctx, 'scroll ↓', {
        x: bx + bw - SCROLLBAR_W / TOGGLE_W_DIVISOR - SCROLL_HINT_X_OFFSET,
        y: perkAreaTop + perkAreaH - SCROLL_HINT_Y_OFFSET - SCROLL_HINT_Y_ADJUST,
        size: SCROLL_HINT_SIZE,
        color: 'rgba(148,163,184,0.7)',
        align: 'center',
      });
    }
  }

  // Back button
  addButton(ctx, buttons, {
    x: bx + BACK_BTN_X,
    y: by + bh - backBtnH + PERK_AREA_BACK_BTN_Y_OFFSET,
    width: bw - BACK_BUTTON_MARGIN,
    height: BACK_BUTTON_HEIGHT,
    label: '← Back to Abilities',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'list';
      touchStartY = null;
    },
  });
}
