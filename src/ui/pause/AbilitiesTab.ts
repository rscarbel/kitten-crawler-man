import type { AbilityManager, AbilityDef, AbilityId } from '../../core/AbilityManager';
import type { Inventory } from '../../core/Inventory';
import { HOTBAR_COUNT } from '../../core/ItemDefs';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText, measureTextBox } from '../TextBox';
import { drawBox, drawDivider, drawProgressBar, drawScrollbar } from '../Box';

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
    listScrollY = Math.max(0, Math.min(maxScroll, listScrollY + deltaY * 0.5));
  } else {
    const maxScroll = Math.max(0, detailContentH - detailViewportH);
    detailScrollY = Math.max(0, Math.min(maxScroll, detailScrollY + deltaY * 0.5));
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

const LIST_ROW_H = 54;
const LIST_HEADER_H = 82; // extra space for the Equipped Abilities button
const LIST_FOOTER_H = 48;
const SCROLLBAR_W = 6;

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
    y: by + 22 - 10,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });

  addButton(ctx, buttons, {
    x: bx + 16,
    y: by + 34,
    width: bw - 32,
    height: 30,
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
      x: bx + bw / 2,
      y: listAreaTop + 20 - 10,
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

      const iconSize = 36;
      const iconX = bx + 16;
      def.renderIcon(ctx, iconX, rowY + 2, iconSize, state.level);

      const textX = iconX + iconSize + 10;
      drawText(ctx, def.name, {
        x: textX,
        y: rowY + 16 - 10,
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
        x: textX + nameWidth + 8,
        y: rowY + 15 - 8,
        bold: true,
        size: 10,
        color: ownerColor,
      });
      drawText(ctx, `Level ${state.level} / ${def.maxLevel}`, {
        x: textX,
        y: rowY + 30 - 9,
        size: 11,
        color: '#94a3b8',
      });

      const barX = textX;
      const barW = bw - iconSize - 90 - SCROLLBAR_W - 4;
      const barH = 6;
      const barY = rowY + 38;
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
        const btnW = 88;
        const btnX = bx + bw - btnW - SCROLLBAR_W - 12;
        const detailId = def.id;
        addButton(ctx, buttons, {
          x: btnX,
          y: rowY + 4,
          width: btnW,
          height: 32,
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

  const backY = by + bh - LIST_FOOTER_H + 7;
  addButton(ctx, buttons, {
    x: bx + 20,
    y: backY,
    width: bw - 40,
    height: 34,
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
  const pad = 6;
  const ttW = tw + pad * 2;
  const ttH = 20;
  let ttX = x + 8;
  let ttY = y - ttH - 4;
  if (ttX + ttW > bx + bw) ttX = bx + bw - ttW - 2;
  if (ttY < by + 2) ttY = y + 16;
  drawBox(ctx, {
    x: ttX,
    y: ttY,
    width: ttW,
    height: ttH,
    fill: 'rgba(15,23,42,0.95)',
    border: '#7c3aed',
    borderWidth: 1,
  });
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(text, ttX + pad, ttY + ttH - 5);
  ctx.restore();
}

// Equipped Abilities View

const EQ_SLOT_SIZE = 40;
const EQ_SLOT_GAP = 6;
const EQ_HEADER_H = 72;
const EQ_FOOTER_H = 44;

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
    y: by + 22 - 10,
    bold: true,
    size: 15,
    color: '#e9d5ff',
    align: 'center',
  });

  // Player toggle
  const toggleY = by + 34;
  const toggleW = (bw - 40) / 2;
  const humanColor = equippedPlayer === 'human' ? '#fb923c' : '#475569';
  const catColor = equippedPlayer === 'cat' ? '#38bdf8' : '#475569';

  drawBox(ctx, {
    x: bx + 16,
    y: toggleY,
    width: toggleW,
    height: 24,
    fill: equippedPlayer === 'human' ? 'rgba(251,146,60,0.18)' : 'rgba(30,41,59,0.6)',
  });
  drawText(ctx, 'Human', {
    x: bx + 16 + toggleW / 2,
    y: toggleY + 15 - 9,
    bold: equippedPlayer === 'human',
    size: 12,
    color: humanColor,
    align: 'center',
  });
  buttons.push({
    x: bx + 16,
    y: toggleY,
    w: toggleW,
    h: 24,
    action: () => {
      equippedPlayer = 'human';
    },
  });

  drawBox(ctx, {
    x: bx + 24 + toggleW,
    y: toggleY,
    width: toggleW,
    height: 24,
    fill: equippedPlayer === 'cat' ? 'rgba(56,189,248,0.18)' : 'rgba(30,41,59,0.6)',
  });
  drawText(ctx, 'Cat', {
    x: bx + 24 + toggleW + toggleW / 2,
    y: toggleY + 15 - 9,
    bold: equippedPlayer === 'cat',
    size: 12,
    color: catColor,
    align: 'center',
  });
  buttons.push({
    x: bx + 24 + toggleW,
    y: toggleY,
    w: toggleW,
    h: 24,
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
    x: bx + 16,
    y: contentY + 12 - 8,
    bold: true,
    size: 11,
    color: '#94a3b8',
  });

  const slotRowY = contentY + 18;
  const totalSlots = HOTBAR_COUNT - 1; // exclude quest slot
  const rowW = totalSlots * (EQ_SLOT_SIZE + EQ_SLOT_GAP) - EQ_SLOT_GAP;
  const rowX = bx + (bw - rowW) / 2;

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
      x: sx + 4,
      y: sy + 9 - 7,
      size: 8,
      color: '#64748b',
    });

    if (slot !== null) {
      if (isAbilityTome && slot.abilityId !== undefined && isAbilityId(slot.abilityId)) {
        const abilityIdTyped = slot.abilityId;
        const def = abilityManager.getDef(abilityIdTyped);
        if (def) {
          const iconPad = 4;
          const iconSize = EQ_SLOT_SIZE - iconPad * 2;
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
          const rmY = sy + EQ_SLOT_SIZE + 3;
          const slotCapture = slot;
          addButton(ctx, buttons, {
            x: sx,
            y: rmY,
            width: EQ_SLOT_SIZE,
            height: 16,
            label: '✕',
            ...BUTTON_PRESETS.danger,
            labelSize: 10,
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
          x: sx + 6,
          y: sy + 6,
          width: EQ_SLOT_SIZE - 12,
          height: EQ_SLOT_SIZE - 12,
          fill: 'rgba(100,116,139,0.35)',
        });
        drawText(ctx, 'item', {
          x: sx + EQ_SLOT_SIZE / 2,
          y: sy + EQ_SLOT_SIZE / 2 + 4,
          size: 8,
          color: '#475569',
          align: 'center',
        });
      }
    }
  }

  // Available abilities section
  const availSectionY = slotRowY + EQ_SLOT_SIZE + 26;
  drawText(ctx, 'Available Abilities', {
    x: bx + 16,
    y: availSectionY - 10,
    bold: true,
    size: 11,
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
      x: bx + bw / 2,
      y: availSectionY + 16,
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

      const iconPad = 4;
      def.renderIcon(
        ctx,
        availX + iconPad,
        sy + iconPad,
        EQ_SLOT_SIZE - iconPad * 2,
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
      const addBtnY = sy + EQ_SLOT_SIZE + 3;
      const bagIdxCapture = bagIdx;
      addButton(ctx, buttons, {
        x: availX,
        y: addBtnY,
        width: EQ_SLOT_SIZE,
        height: 16,
        label: '+Add',
        ...BUTTON_PRESETS.success,
        labelSize: 9,
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
    x: bx + 20,
    y: by + bh - EQ_FOOTER_H + 6,
    width: bw - 40,
    height: 34,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'list';
      touchStartY = null;
    },
  });
}

const DETAIL_PERK_ROW_H = 24;
const DETAIL_PERK_LINE_H = 12;
const DETAIL_PERK_VPAD = 5;

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
    x: bx + bw / 2,
    y: by + 24 - 12,
    bold: true,
    size: 15,
    color: '#e9d5ff',
    align: 'center',
  });

  // Owner
  const ownerLabel = state.owner === 'cat' ? 'Cat' : 'Human';
  const ownerColor = state.owner === 'cat' ? '#38bdf8' : '#fb923c';
  drawText(ctx, `Owner: ${ownerLabel}`, {
    x: bx + bw / 2,
    y: by + 38 - 9,
    bold: true,
    size: 11,
    color: ownerColor,
    align: 'center',
  });

  // Equip instructions
  drawText(ctx, `How to equip: ${def.equipInstructions}`, {
    x: bx + bw / 2,
    y: by + 50 - 8,
    size: 10,
    color: '#64748b',
    align: 'center',
  });

  let y = by + 64;

  // Level + XP bar
  drawText(ctx, `Current level: ${currentLevel}`, {
    x: bx + 16,
    y: y - 10,
    size: 12,
    color: '#94a3b8',
  });
  y += 14;

  const barX = bx + 16;
  const barW = bw - 32;
  const barH = 8;
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
  y += barH + 14;

  if (currentLevel < def.maxLevel) {
    drawText(ctx, `XP to next level: ${state.xp} / ${state.xpToNextLevel}`, {
      x: bx + 16,
      y: y - 8,
      size: 10,
      color: '#64748b',
    });
  } else {
    drawText(ctx, 'MAX LEVEL', { x: bx + 16, y: y - 8, bold: true, size: 10, color: '#fbbf24' });
  }
  y += 14;

  // Separator
  drawDivider(ctx, { x: bx + 16, y, length: bw - 32, color: '#334155' });
  y += 10;

  // Perks heading
  drawText(ctx, 'Level Perks:', { x: bx + 16, y: y - 9, bold: true, size: 11, color: '#94a3b8' });
  y += 14;

  // Scrollable perks area
  const backBtnH = 44;
  const perkAreaTop = y;
  const perkAreaH = bh - (perkAreaTop - by) - backBtnH;
  const descMaxW = bw - 44 - SCROLLBAR_W - 4;

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
        x: bx + 8,
        y: perkY - 2,
        width: bw - 16,
        height: rowH,
        fill: 'rgba(109,40,217,0.18)',
      });
    }

    // Level badge — vertically centered in row
    const badgeY = perkY + Math.floor((rowH - 18) / 2);
    drawBox(ctx, {
      x: bx + 10,
      y: badgeY,
      width: 22,
      height: 18,
      fill: unlocked ? '#7c3aed' : '#334155',
    });
    drawText(ctx, String(perk.level), {
      x: bx + 21,
      y: badgeY + 13 - 8,
      bold: true,
      size: 10,
      color: unlocked ? '#ede9fe' : '#64748b',
      align: 'center',
    });

    // Description — word-wrapped via drawText
    const descX = bx + 38;
    const firstLineTop = perkY + DETAIL_PERK_VPAD;
    drawText(ctx, displayText, {
      x: descX,
      y: firstLineTop,
      size: 10,
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
        x: bx + bw - SCROLLBAR_W / 2 - 2,
        y: perkAreaTop + perkAreaH - 4 - 7,
        size: 9,
        color: 'rgba(148,163,184,0.7)',
        align: 'center',
      });
    }
  }

  // Back button
  addButton(ctx, buttons, {
    x: bx + 20,
    y: by + bh - backBtnH + 6,
    width: bw - 40,
    height: 34,
    label: '← Back to Abilities',
    ...BUTTON_PRESETS.primary,
    action: () => {
      currentView = 'list';
      touchStartY = null;
    },
  });
}
