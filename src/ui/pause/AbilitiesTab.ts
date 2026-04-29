import type { AbilityManager, AbilityDef, AbilityId } from '../../core/AbilityManager';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { wrapTextLines } from '../canvasUtils';

type AbilitiesView = 'list' | AbilityId;

let currentView: AbilitiesView = 'list';

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
): void {
  if (currentView === 'list') {
    renderListView(ctx, buttons, bx, by, bw, bh, setTab, abilityManager);
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
const LIST_HEADER_H = 52;
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
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Abilities Unlocked', bx + bw / 2, by + 30);
  ctx.textAlign = 'left';

  const abilities = abilityManager.getAllRegistered();
  const listAreaTop = by + LIST_HEADER_H;
  const areaH = bh - LIST_HEADER_H - LIST_FOOTER_H;
  listViewportH = areaH;
  listContentH = abilities.length * LIST_ROW_H;

  if (abilities.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No abilities unlocked yet.', bx + bw / 2, listAreaTop + 20);
    ctx.textAlign = 'left';
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

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(def.name, iconX + iconSize + 10, rowY + 16);

      const ownerLabel = state.owner === 'cat' ? 'Cat' : 'Human';
      const ownerColor = state.owner === 'cat' ? '#38bdf8' : '#fb923c';
      const nameWidth = ctx.measureText(def.name).width;
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = ownerColor;
      ctx.fillText(ownerLabel, iconX + iconSize + 10 + nameWidth + 8, rowY + 15);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px monospace';
      ctx.fillText(`Level ${state.level} / ${def.maxLevel}`, iconX + iconSize + 10, rowY + 30);

      const barX = iconX + iconSize + 10;
      const barW = bw - iconSize - 90 - SCROLLBAR_W - 4;
      const barH = 6;
      const barY = rowY + 38;
      const xpFrac = state.xpToNextLevel === Infinity ? 1 : state.xp / state.xpToNextLevel;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(barX, barY, Math.round(barW * Math.min(xpFrac, 1)), barH);

      if (visible) {
        const btnW = 88;
        const btnX = bx + bw - btnW - SCROLLBAR_W - 12;
        const detailId = def.id;
        menuBtn(ctx, buttons, btnX, rowY + 4, btnW, 32, 'Details', () => {
          currentView = detailId;
          detailScrollY = 0;
          touchStartY = null;
        });
      }

      rowY += LIST_ROW_H;
    }

    ctx.restore();

    if (listContentH > areaH) {
      const trackX = bx + bw - SCROLLBAR_W - 2;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(trackX, listAreaTop, SCROLLBAR_W, areaH);

      const thumbH = Math.max(20, (areaH / listContentH) * areaH);
      const maxScroll = listContentH - areaH;
      const thumbY = listAreaTop + (listScrollY / maxScroll) * (areaH - thumbH);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(trackX, thumbY, SCROLLBAR_W, thumbH);
    }
  }

  const backY = by + bh - LIST_FOOTER_H + 7;
  menuBtn(ctx, buttons, bx + 20, backY, bw - 40, 34, '← Back', () => {
    currentView = 'list';
    setTab('main');
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
  ctx.fillStyle = '#e9d5ff';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(def.name, bx + bw / 2, by + 24);
  ctx.textAlign = 'left';

  // Owner
  const ownerLabel = state.owner === 'cat' ? 'Cat' : 'Human';
  const ownerColor = state.owner === 'cat' ? '#38bdf8' : '#fb923c';
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = ownerColor;
  ctx.textAlign = 'center';
  ctx.fillText(`Owner: ${ownerLabel}`, bx + bw / 2, by + 38);
  ctx.textAlign = 'left';

  // Equip instructions
  ctx.fillStyle = '#64748b';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`How to equip: ${def.equipInstructions}`, bx + bw / 2, by + 50);
  ctx.textAlign = 'left';

  let y = by + 64;

  // Level + XP bar
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px monospace';
  ctx.fillText(`Current level: ${currentLevel}`, bx + 16, y);
  y += 14;

  const barX = bx + 16;
  const barW = bw - 32;
  const barH = 8;
  const xpFrac = state.xpToNextLevel === Infinity ? 1 : state.xp / state.xpToNextLevel;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(barX, y, barW, barH);
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(barX, y, Math.round(barW * Math.min(xpFrac, 1)), barH);
  y += barH + 14;

  if (currentLevel < def.maxLevel) {
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(`XP to next level: ${state.xp} / ${state.xpToNextLevel}`, bx + 16, y);
  } else {
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('MAX LEVEL', bx + 16, y);
  }
  y += 14;

  // Separator
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + 16, y);
  ctx.lineTo(bx + bw - 16, y);
  ctx.stroke();
  y += 10;

  // Perks heading
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('Level Perks:', bx + 16, y);
  y += 14;

  // Scrollable perks area
  const backBtnH = 44;
  const perkAreaTop = y;
  const perkAreaH = bh - (perkAreaTop - by) - backBtnH;
  const descMaxW = bw - 44 - SCROLLBAR_W - 4;

  // Pre-pass: measure wrapped lines and row heights for each perk
  const perksLayout = def.perks.map((perk) => {
    const unlocked = currentLevel >= perk.level;
    ctx.font = `${unlocked ? 'bold ' : ''}10px monospace`;
    const lines = wrapTextLines(ctx, perk.description, descMaxW);
    const rowH = Math.max(
      DETAIL_PERK_ROW_H,
      DETAIL_PERK_VPAD * 2 + lines.length * DETAIL_PERK_LINE_H,
    );
    return { perk, lines, rowH, unlocked };
  });

  detailViewportH = perkAreaH;
  detailContentH = perksLayout.reduce((sum, { rowH }) => sum + rowH, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, perkAreaTop, bw - SCROLLBAR_W - 2, perkAreaH);
  ctx.clip();

  let perkY = perkAreaTop - detailScrollY;
  for (const { perk, lines, rowH, unlocked } of perksLayout) {
    const isNew = perk.level === currentLevel;

    if (isNew) {
      ctx.fillStyle = 'rgba(109,40,217,0.18)';
      ctx.fillRect(bx + 8, perkY - 2, bw - 16, rowH);
    }

    // Level badge — vertically centered in row
    const badgeY = perkY + Math.floor((rowH - 18) / 2);
    ctx.fillStyle = unlocked ? '#7c3aed' : '#334155';
    ctx.fillRect(bx + 10, badgeY, 22, 18);
    ctx.fillStyle = unlocked ? '#ede9fe' : '#64748b';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(perk.level), bx + 21, badgeY + 13);
    ctx.textAlign = 'left';

    // Description lines
    ctx.fillStyle = unlocked ? '#e2e8f0' : '#475569';
    ctx.font = `${unlocked ? 'bold ' : ''}10px monospace`;
    const descX = bx + 38;
    const firstLineBaseline = perkY + DETAIL_PERK_VPAD + DETAIL_PERK_LINE_H;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i] ?? '', descX, firstLineBaseline + i * DETAIL_PERK_LINE_H);
    }

    perkY += rowH;
  }

  ctx.restore();

  // Scrollbar
  if (detailContentH > perkAreaH) {
    const trackX = bx + bw - SCROLLBAR_W - 2;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(trackX, perkAreaTop, SCROLLBAR_W, perkAreaH);

    const thumbH = Math.max(20, (perkAreaH / detailContentH) * perkAreaH);
    const maxScroll = detailContentH - perkAreaH;
    const thumbY = perkAreaTop + (detailScrollY / maxScroll) * (perkAreaH - thumbH);
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(trackX, thumbY, SCROLLBAR_W, thumbH);

    // Scroll hint
    if (detailScrollY === 0) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('scroll ↓', bx + bw - SCROLLBAR_W / 2 - 2, perkAreaTop + perkAreaH - 4);
      ctx.textAlign = 'left';
    }
  }

  // Back button
  menuBtn(ctx, buttons, bx + 20, by + bh - backBtnH + 6, bw - 40, 34, '← Back to Abilities', () => {
    currentView = 'list';
    touchStartY = null;
  });
}
