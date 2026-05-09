import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { StatusEffect } from '../core/StatusEffect';
import { platform } from '../core/Platform';
import { drawText } from './TextBox';
import { drawBox, drawProgressBar } from './Box';

/**
 * Draws the top-left HUD panel: active-character label, control hints,
 * HP/XP bars for both characters, and the skill-point notification banner.
 *
 * @param pulseRef - Mutable object holding the oscillation counter for the
 *   notification pulse. Pass `{ value: 0 }` from the scene and keep it stable.
 */
/**
 * Returns the rect of the collapse/expand toggle button (mobile only).
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  _canvas: HTMLCanvasElement,
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
  collapsed = false,
): { x: number; y: number; w: number; h: number } {
  if (platform.showHudCollapseToggle && collapsed) {
    return drawHUDCollapsed(ctx, human, cat);
  }

  const activeLabel = human.isActive ? 'Human' : 'Cat';
  const inactiveLabel = human.isActive ? 'Cat' : 'Human';
  const atkLabel = human.isActive ? 'Punch / Kick' : 'Magic Missile';

  const activePlayer = human.isActive ? human : cat;
  const inactivePlayer = human.isActive ? cat : human;

  drawBox(ctx, { x: 8, y: 8, width: 340, height: 190, fill: 'rgba(0,0,0,0.6)' });

  drawText(ctx, `Playing as: ${activeLabel}`, {
    x: 16,
    y: 18,
    bold: true,
    size: 13,
    color: '#facc15',
  });

  const [hintLine1, hintLine2] = platform.controlHints(atkLabel);
  drawText(ctx, hintLine1, { x: 16, y: 36, size: 12, color: '#e2e8f0' });
  drawText(ctx, hintLine2, { x: 16, y: 52, size: 12, color: '#e2e8f0' });

  drawHUDPlayerBlock(ctx, activeLabel, activePlayer, 16, 74);
  drawHUDPlayerBlock(ctx, inactiveLabel, inactivePlayer, 16, 128);

  // Coins row
  drawText(ctx, `\u{1FA99} ${human.coins + cat.coins}  coins`, {
    x: 16,
    y: 176,
    size: 11,
    color: '#fbbf24',
  });

  renderNotification(ctx, human, cat, pulseRef);

  if (platform.showHudCollapseToggle) {
    // Collapse toggle — small "▲" button at top-right of panel
    const toggleRect = { x: 336, y: 8, w: 28, h: 22 };
    drawBox(ctx, {
      x: toggleRect.x,
      y: toggleRect.y,
      width: toggleRect.w,
      height: toggleRect.h,
      fill: 'rgba(0,0,0,0.7)',
      border: '#475569',
      borderWidth: 1,
    });
    drawText(ctx, '▲', {
      x: toggleRect.x + toggleRect.w / 2,
      y: toggleRect.y + 6,
      size: 11,
      color: '#94a3b8',
      align: 'center',
    });
    return toggleRect;
  }
  return { x: -9999, y: 0, w: 0, h: 0 };
}

/** Compact single-row HUD for mobile collapsed state. */
function drawHUDCollapsed(
  ctx: CanvasRenderingContext2D,
  human: HumanPlayer,
  cat: CatPlayer,
): { x: number; y: number; w: number; h: number } {
  const BAR_W = 180;
  const BAR_H = 26;
  const x = 8;
  const y = 8;

  drawBox(ctx, {
    x,
    y,
    width: BAR_W,
    height: BAR_H,
    fill: 'rgba(0,0,0,0.7)',
    border: '#475569',
    borderWidth: 1,
  });

  // Human HP
  const hHp = human.hp / human.maxHp;
  const cHp = cat.hp / cat.maxHp;
  drawText(ctx, '\u{1F9CD}', { x: x + 6, y: y + 9, size: 10, color: '#94a3b8' });
  drawProgressBar(ctx, {
    x: x + 22,
    y: y + 7,
    width: 60,
    height: 6,
    value: hHp,
    fill: hHp > 0.5 ? '#4ade80' : hHp > 0.25 ? '#facc15' : '#ef4444',
    background: '#374151',
  });

  drawText(ctx, '\u{1F431}', { x: x + 90, y: y + 9, size: 10, color: '#94a3b8' });
  drawProgressBar(ctx, {
    x: x + 106,
    y: y + 7,
    width: 60,
    height: 6,
    value: cHp,
    fill: cHp > 0.5 ? '#4ade80' : cHp > 0.25 ? '#facc15' : '#ef4444',
    background: '#374151',
  });

  // Expand toggle
  const toggleRect = { x: x + BAR_W, y, w: 26, h: BAR_H };
  drawBox(ctx, {
    x: toggleRect.x,
    y: toggleRect.y,
    width: toggleRect.w,
    height: toggleRect.h,
    fill: 'rgba(0,0,0,0.7)',
    border: '#475569',
    borderWidth: 1,
  });
  drawText(ctx, '▼', {
    x: toggleRect.x + toggleRect.w / 2,
    y: toggleRect.y + 8,
    size: 11,
    color: '#94a3b8',
    align: 'center',
  });

  return toggleRect;
}

export function drawHUDPlayerBlock(
  ctx: CanvasRenderingContext2D,
  label: string,
  player: HumanPlayer | CatPlayer,
  x: number,
  y: number,
): void {
  const barX = x + 88;
  const barW = 90;
  const barH = 7;

  // HP bar
  const hpRatio = player.hp / player.maxHp;
  drawText(ctx, `${label} Lv${player.level}:`, { x, y: y + barH - 8, size: 10, color: '#94a3b8' });

  drawProgressBar(ctx, {
    x: barX,
    y,
    width: barW,
    height: barH,
    value: hpRatio,
    fill: hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444',
    background: '#374151',
  });

  drawText(ctx, `${player.hp}/${player.maxHp}`, {
    x: barX + barW + 4,
    y: y + barH - 8,
    size: 10,
    color: '#e2e8f0',
  });

  // XP bar
  const xpNeeded = player.level * 10;
  const xpRatio = Math.min(1, player.xp / xpNeeded);
  const y2 = y + 14;

  drawText(ctx, 'XP:', { x, y: y2 + barH - 8, size: 10, color: '#64748b' });

  drawProgressBar(ctx, {
    x: barX,
    y: y2,
    width: barW,
    height: barH,
    value: xpRatio,
    fill: '#818cf8',
    background: '#1e293b',
  });

  drawText(ctx, `${player.xp}/${xpNeeded}`, {
    x: barX + barW + 4,
    y: y2 + barH - 8,
    size: 10,
    color: '#94a3b8',
  });

  // Stats + potions
  drawText(
    ctx,
    `STR:${player.strength}  INT:${player.intelligence}  HP:${player.constitution}  🧪${player.healthPotions}`,
    { x: barX, y: y2 + barH + 4, size: 10, color: '#cbd5e1' },
  );

  // Status effect badges (Burn, Frozen, Paralyzed, …)
  if (player.statusEffects.length > 0) {
    let iconX = barX;
    for (const effect of player.statusEffects) {
      drawStatusIcon(ctx, effect, iconX, y2 + barH + 16);
      iconX += 30;
    }
  }
}

/**
 * Renders a single status-effect badge: a coloured pill with a short label and
 * a small duration bar across the bottom.
 *
 * Adding a new status type: add an `else if` branch below with the desired
 * colour and label.
 */
function drawStatusIcon(ctx: CanvasRenderingContext2D, effect: StatusEffect, x: number, y: number) {
  const pillW = 26;
  const pillH = 12;

  let bgColor = '#6b7280';
  let label = effect.type.toUpperCase().slice(0, 4);

  if (effect.type === 'burn') {
    bgColor = '#f97316';
    label = 'BURN';
  } else if (effect.type === 'frozen') {
    bgColor = '#38bdf8';
    label = 'FRZE';
  } else if (effect.type === 'paralyzed') {
    bgColor = '#a855f7';
    label = 'PARA';
  }

  // Background pill
  drawBox(ctx, { x, y, width: pillW, height: pillH, fill: bgColor });

  // Label
  drawText(ctx, label, { x: x + 2, y: y + 2, bold: true, size: 7, color: '#fff' });

  // Duration bar (white strip across the bottom of the pill)
  const ratio = effect.ticksRemaining / effect.totalTicks;
  drawProgressBar(ctx, {
    x: x + 1,
    y: y + pillH - 3,
    width: pillW - 2,
    height: 2,
    value: ratio,
    fill: 'rgba(255,255,255,0.85)',
    background: 'rgba(0,0,0,0.4)',
  });
}

/**
 * Pulsing skill-point notification banner rendered below the HUD panel.
 */
function renderNotification(
  ctx: CanvasRenderingContext2D,
  human: Player,
  cat: Player,
  pulseRef: { value: number },
): void {
  if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) return;
  pulseRef.value = (pulseRef.value + 0.055) % (Math.PI * 2);
  const alpha = 0.65 + Math.sin(pulseRef.value) * 0.28;
  drawBox(ctx, {
    x: 8,
    y: 192,
    width: 340,
    height: 20,
    fill: '#1e3a5f',
    border: '#3b82f6',
    borderWidth: 1,
    alpha,
  });
  drawText(ctx, platform.skillPointBanner, { x: 14, y: 198, size: 10, color: '#93c5fd' });
}
