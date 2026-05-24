import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { StatusEffect } from '../core/StatusEffect';
import { platform } from '../core/Platform';
import { drawText } from './TextBox';
import { drawBox, drawProgressBar } from './Box';

type HudRect = { x: number; y: number; w: number; h: number };
type HudResult = { toggleRect: HudRect; notifRect: HudRect; hudPanelBottom: number };

const HIDDEN_RECT: HudRect = { x: -9999, y: 0, w: 0, h: 0 };

// Layout constants
const PANEL_START_X = 8;
const PANEL_START_Y = 8;
const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 190;
const ACTIVE_PLAYER_Y = 74;
const INACTIVE_PLAYER_Y = 128;
const CONTROL_HINTS_Y1 = 36;
const CONTROL_HINTS_Y2 = 52;
const COINS_Y = 176;
const HINT_SIZE = 12;
const CONTROL_HINT_X = 16;
const CONTROL_HINT_Y_OFFSET = 18;

// Toggle button constants
const TOGGLE_BTN_X = 336;
const TOGGLE_BTN_Y = 8;
const TOGGLE_BTN_W = 28;
const TOGGLE_BTN_H = 22;
const TOGGLE_BTN_TEXT_Y_OFFSET = 6;
const TOGGLE_BTN_TEXT_SIZE = 11;

// Collapsed HUD constants
const COLLAPSED_BAR_W = 180;
const COLLAPSED_BAR_H = 26;
const COLLAPSED_X = 8;
const COLLAPSED_Y = 8;
const COLLAPSED_ICON_X = 6;
const COLLAPSED_ICON_Y = 9;
const COLLAPSED_ICON_SIZE = 10;
const COLLAPSED_HP_X = 22;
const COLLAPSED_HP_Y = 7;
const COLLAPSED_HP_WIDTH = 60;
const COLLAPSED_HP_HEIGHT = 6;
const COLLAPSED_HP_THRESHOLD_HIGH = 0.5;
const COLLAPSED_HP_THRESHOLD_LOW = 0.25;
const COLLAPSED_CAT_ICON_X = 90;
const COLLAPSED_CAT_HP_X = 106;
const COLLAPSED_TOGGLE_X_OFFSET = COLLAPSED_BAR_W;

// Skill badge constants
const BADGE_X = 8;
const BADGE_MAX_W = 206;
const BADGE_MINIMAP_WIDTH = 160;
const BADGE_MINIMAP_MARGIN = 8;
const BADGE_MINIMAP_GAP = 16;
const BADGE_H = 44;
const BADGE_SHADOW_BLUR = 8;
const BADGE_PULSE_SHADOW_MULT = 8;
const BADGE_FILL_RGB = 'rgba(40,24,0,0.96)';
const BADGE_BORDER_BASE_ALPHA = 0.65;
const BADGE_BORDER_PULSE_ALPHA = 0.35;
const BADGE_LINE_WIDTH_MIN = 1.5;
const BADGE_LINE_WIDTH_PULSE_MULT = 0.5;
const BADGE_TEXT_Y_OFFSET = 10;
const BADGE_TEXT_SUB_Y_OFFSET = 27;
const BADGE_TEXT_SIZE = 11;
const BADGE_TEXT_SUB_SIZE = 10;
const BADGE_TEXT_COLOR_MIN_ALPHA = 0.85;
const BADGE_TEXT_COLOR_PULSE_ALPHA = 0.15;
const BADGE_PULSE_INCREMENT = 0.05;

// Notification banner constants
const NOTIF_Y = 202;
const NOTIF_H = 52;
const NOTIF_WIDTH_FULL = 340;
const NOTIF_WIDTH_MIN = 180;
const NOTIF_SHADOW_BLUR_BASE = 14;
const NOTIF_SHADOW_BLUR_PULSE = 12;
const NOTIF_BORDER_BASE_ALPHA = 0.65;
const NOTIF_BORDER_PULSE_ALPHA = 0.35;
const NOTIF_FILL = 'rgba(40,24,0,0.96)';
const NOTIF_ICON_X = 28;
const NOTIF_ICON_Y = 34;
const NOTIF_TEXT_X = 52;
const NOTIF_TEXT_Y = 14;
const NOTIF_TEXT_SIZE = 13;
const NOTIF_SUB_Y = 32;
const NOTIF_SUB_SIZE = 11;
const NOTIF_SUB_COLOR_MIN_ALPHA = 0.75;
const NOTIF_SUB_COLOR_PULSE_ALPHA = 0.25;
const NOTIF_CHEVRON_X_OFFSET = 14;
const NOTIF_CHEVRON_Y = 22;
const NOTIF_CHEVRON_SIZE = 14;
const NOTIF_CHEVRON_COLOR_MIN_ALPHA = 0.7;
const NOTIF_CHEVRON_COLOR_PULSE_ALPHA = 0.3;
const NOTIF_BOUNCE_FREQ = 0.6;
const NOTIF_BOUNCE_AMP = 3;
const NOTIF_TEXT_COLOR_MIN_ALPHA = 0.9;
const NOTIF_TEXT_COLOR_PULSE_ALPHA = 0.1;
const NOTIF_ICON_COLOR_MIN_ALPHA = 0.8;
const NOTIF_ICON_COLOR_PULSE_ALPHA = 0.2;

// Player block constants
const PLAYER_BLOCK_BAR_X_OFFSET = 88;
const PLAYER_BLOCK_BAR_W = 90;
const PLAYER_BLOCK_BAR_H = 7;
const PLAYER_BLOCK_TEXT_Y_OFFSET = 8;
const PLAYER_BLOCK_TEXT_SIZE = 10;
const PLAYER_BLOCK_HP_THRESHOLD_HIGH = 0.5;
const PLAYER_BLOCK_HP_THRESHOLD_LOW = 0.25;
const PLAYER_BLOCK_HP_TEXT_X_OFFSET = 4;
const PLAYER_BLOCK_XP_Y_OFFSET = 14;
const PLAYER_BLOCK_STATS_Y_OFFSET = 4;
const PLAYER_LEVEL_XP_MULTIPLIER = 10;

// Status icon constants
const STATUS_ICON_PILL_W = 26;
const STATUS_ICON_PILL_H = 12;
const STATUS_ICON_LABEL_X_OFFSET = 2;
const STATUS_ICON_LABEL_Y_OFFSET = 2;
const STATUS_ICON_LABEL_SIZE = 7;
const STATUS_ICON_BAR_Y_OFFSET = 3;
const STATUS_ICON_BAR_W = 2;
const STATUS_ICON_ROW_Y_OFFSET = 16;
const STATUS_ICON_NEXT_X_OFFSET = 30;
const STATUS_ICON_LABEL_CHAR_LIMIT = 4;

// Pulse constants
const PULSE_AMPLITUDE = 0.5;
const PULSE_BASE = 0.5;

/**
 * Draws the top-left HUD panel: active-character label, control hints,
 * HP/XP bars for both characters, and the skill-point notification banner.
 *
 * Returns `toggleRect` (mobile collapse/expand button, else hidden) and
 * `notifRect` (skill-point banner or collapsed badge when visible, else hidden).
 *
 * @param pulseRef - Mutable object holding the oscillation counter for the
 *   notification pulse. Pass `{ value: 0 }` from the scene and keep it stable.
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
  collapsed = false,
): HudResult {
  if (platform.showHudCollapseToggle && collapsed) {
    return drawHUDCollapsed(ctx, canvas, human, cat, pulseRef);
  }

  const activeLabel = human.isActive ? 'Human' : 'Cat';
  const inactiveLabel = human.isActive ? 'Cat' : 'Human';
  const atkLabel = human.isActive ? 'Punch / Kick' : 'Magic Missile';

  const activePlayer = human.isActive ? human : cat;
  const inactivePlayer = human.isActive ? cat : human;

  const panelTopY = PANEL_START_Y;
  const panelHeight = PANEL_HEIGHT;
  drawBox(ctx, {
    x: PANEL_START_X,
    y: panelTopY,
    width: PANEL_WIDTH,
    height: panelHeight,
    fill: 'rgba(0,0,0,0.6)',
  });

  drawText(ctx, `Playing as: ${activeLabel}`, {
    x: CONTROL_HINT_X,
    y: CONTROL_HINT_Y_OFFSET,
    bold: true,
    size: 13,
    color: '#facc15',
  });

  const [hintLine1, hintLine2] = platform.controlHints(atkLabel);
  drawText(ctx, hintLine1, {
    x: CONTROL_HINT_X,
    y: CONTROL_HINTS_Y1,
    size: HINT_SIZE,
    color: '#e2e8f0',
  });
  drawText(ctx, hintLine2, {
    x: CONTROL_HINT_X,
    y: CONTROL_HINTS_Y2,
    size: HINT_SIZE,
    color: '#e2e8f0',
  });

  drawHUDPlayerBlock(ctx, activeLabel, activePlayer, CONTROL_HINT_X, ACTIVE_PLAYER_Y);
  drawHUDPlayerBlock(ctx, inactiveLabel, inactivePlayer, CONTROL_HINT_X, INACTIVE_PLAYER_Y);

  // Coins row
  drawText(ctx, `\u{1FA99} ${human.coins + cat.coins}  coins`, {
    x: CONTROL_HINT_X,
    y: COINS_Y,
    size: 11,
    color: '#fbbf24',
  });

  const notifRect = renderNotification(ctx, canvas, human, cat, pulseRef);
  const hudPanelBottom = panelTopY + panelHeight;

  if (platform.showHudCollapseToggle) {
    // Collapse toggle — small "▲" button at top-right of panel
    const toggleRect = { x: TOGGLE_BTN_X, y: TOGGLE_BTN_Y, w: TOGGLE_BTN_W, h: TOGGLE_BTN_H };
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
      y: toggleRect.y + TOGGLE_BTN_TEXT_Y_OFFSET,
      size: TOGGLE_BTN_TEXT_SIZE,
      color: '#94a3b8',
      align: 'center',
    });
    return { toggleRect, notifRect, hudPanelBottom };
  }
  return { toggleRect: HIDDEN_RECT, notifRect, hudPanelBottom };
}

/** Compact single-row HUD for mobile collapsed state. Does not render the skill badge. */
function drawHUDCollapsed(
  ctx: CanvasRenderingContext2D,
  _canvas: HTMLCanvasElement,
  human: HumanPlayer,
  cat: CatPlayer,
  _pulseRef: { value: number },
): HudResult {
  const BAR_W = COLLAPSED_BAR_W;
  const BAR_H = COLLAPSED_BAR_H;
  const x = COLLAPSED_X;
  const y = COLLAPSED_Y;

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
  drawText(ctx, '\u{1F9CD}', {
    x: x + COLLAPSED_ICON_X,
    y: y + COLLAPSED_ICON_Y,
    size: COLLAPSED_ICON_SIZE,
    color: '#94a3b8',
  });
  drawProgressBar(ctx, {
    x: x + COLLAPSED_HP_X,
    y: y + COLLAPSED_HP_Y,
    width: COLLAPSED_HP_WIDTH,
    height: COLLAPSED_HP_HEIGHT,
    value: hHp,
    fill:
      hHp > COLLAPSED_HP_THRESHOLD_HIGH
        ? '#4ade80'
        : hHp > COLLAPSED_HP_THRESHOLD_LOW
          ? '#facc15'
          : '#ef4444',
    background: '#374151',
  });

  drawText(ctx, '\u{1F431}', {
    x: x + COLLAPSED_CAT_ICON_X,
    y: y + COLLAPSED_ICON_Y,
    size: COLLAPSED_ICON_SIZE,
    color: '#94a3b8',
  });
  drawProgressBar(ctx, {
    x: x + COLLAPSED_CAT_HP_X,
    y: y + COLLAPSED_HP_Y,
    width: COLLAPSED_HP_WIDTH,
    height: COLLAPSED_HP_HEIGHT,
    value: cHp,
    fill:
      cHp > COLLAPSED_HP_THRESHOLD_HIGH
        ? '#4ade80'
        : cHp > COLLAPSED_HP_THRESHOLD_LOW
          ? '#facc15'
          : '#ef4444',
    background: '#374151',
  });

  // Expand toggle
  const toggleRect = { x: x + COLLAPSED_TOGGLE_X_OFFSET, y, w: TOGGLE_BTN_W, h: BAR_H };
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
    y: toggleRect.y + COLLAPSED_ICON_Y,
    size: TOGGLE_BTN_TEXT_SIZE,
    color: '#94a3b8',
    align: 'center',
  });

  // Skill badge is rendered separately by the caller so it can be positioned
  // below any boss UI that stacks below this bar.
  return { toggleRect, notifRect: HIDDEN_RECT, hudPanelBottom: y + BAR_H };
}

/**
 * Renders the mobile skill-points badge at the given `topY`.
 * Call this after any boss/arena UI so the badge stacks below them.
 * Returns the badge rect for hit-testing, or HIDDEN_RECT if no unspent points.
 */
export function renderMobileSkillBadge(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
  topY: number,
): HudRect {
  const hasUnspent = human.unspentPoints > 0 || cat.unspentPoints > 0;
  if (!hasUnspent) return HIDDEN_RECT;

  pulseRef.value = (pulseRef.value + BADGE_PULSE_INCREMENT) % (Math.PI * 2);
  const pulse = PULSE_BASE + PULSE_AMPLITUDE * Math.sin(pulseRef.value);

  // Cap width so the badge doesn't overlap the minimap
  const badgeMaxW = Math.min(
    BADGE_MAX_W,
    canvas.width - BADGE_MINIMAP_MARGIN - BADGE_MINIMAP_WIDTH - BADGE_MINIMAP_GAP,
  );
  const badgeRect: HudRect = { x: BADGE_X, y: topY, w: badgeMaxW, h: BADGE_H };

  ctx.save();
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = BADGE_SHADOW_BLUR + BADGE_PULSE_SHADOW_MULT * pulse;
  ctx.fillStyle = BADGE_FILL_RGB;
  ctx.fillRect(badgeRect.x, badgeRect.y, badgeRect.w, badgeRect.h);
  ctx.strokeStyle = `rgba(251,191,36,${BADGE_BORDER_BASE_ALPHA + BADGE_BORDER_PULSE_ALPHA * pulse})`;
  ctx.lineWidth = BADGE_LINE_WIDTH_MIN + pulse * BADGE_LINE_WIDTH_PULSE_MULT;
  ctx.strokeRect(badgeRect.x, badgeRect.y, badgeRect.w, badgeRect.h);
  ctx.shadowBlur = 0;
  ctx.restore();

  const cx = badgeRect.x + badgeRect.w / 2;
  const goldColor = `rgba(251,191,36,${BADGE_TEXT_COLOR_MIN_ALPHA + BADGE_TEXT_COLOR_PULSE_ALPHA * pulse})`;
  drawText(ctx, '★ SKILL POINTS', {
    x: cx,
    y: badgeRect.y + BADGE_TEXT_Y_OFFSET,
    size: BADGE_TEXT_SIZE,
    bold: true,
    color: goldColor,
    align: 'center',
  });
  drawText(ctx, 'Tap to spend', {
    x: cx,
    y: badgeRect.y + BADGE_TEXT_SUB_Y_OFFSET,
    size: BADGE_TEXT_SUB_SIZE,
    color: goldColor,
    align: 'center',
  });

  return badgeRect;
}

export function drawHUDPlayerBlock(
  ctx: CanvasRenderingContext2D,
  label: string,
  player: HumanPlayer | CatPlayer,
  x: number,
  y: number,
): void {
  const barX = x + PLAYER_BLOCK_BAR_X_OFFSET;
  const barW = PLAYER_BLOCK_BAR_W;
  const barH = PLAYER_BLOCK_BAR_H;

  // HP bar
  const hpRatio = player.hp / player.maxHp;
  drawText(ctx, `${label} Lv${player.level}:`, {
    x,
    y: y + barH - PLAYER_BLOCK_TEXT_Y_OFFSET,
    size: PLAYER_BLOCK_TEXT_SIZE,
    color: '#94a3b8',
  });

  drawProgressBar(ctx, {
    x: barX,
    y,
    width: barW,
    height: barH,
    value: hpRatio,
    fill:
      hpRatio > PLAYER_BLOCK_HP_THRESHOLD_HIGH
        ? '#4ade80'
        : hpRatio > PLAYER_BLOCK_HP_THRESHOLD_LOW
          ? '#facc15'
          : '#ef4444',
    background: '#374151',
  });

  drawText(ctx, `${player.hp}/${player.maxHp}`, {
    x: barX + barW + PLAYER_BLOCK_HP_TEXT_X_OFFSET,
    y: y + barH - PLAYER_BLOCK_TEXT_Y_OFFSET,
    size: PLAYER_BLOCK_TEXT_SIZE,
    color: '#e2e8f0',
  });

  // XP bar
  const xpNeeded = player.level * PLAYER_LEVEL_XP_MULTIPLIER;
  const xpRatio = Math.min(1, player.xp / xpNeeded);
  const y2 = y + PLAYER_BLOCK_XP_Y_OFFSET;

  drawText(ctx, 'XP:', {
    x,
    y: y2 + barH - PLAYER_BLOCK_TEXT_Y_OFFSET,
    size: PLAYER_BLOCK_TEXT_SIZE,
    color: '#64748b',
  });

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
    x: barX + barW + PLAYER_BLOCK_HP_TEXT_X_OFFSET,
    y: y2 + barH - PLAYER_BLOCK_TEXT_Y_OFFSET,
    size: PLAYER_BLOCK_TEXT_SIZE,
    color: '#94a3b8',
  });

  // Stats + potions
  drawText(
    ctx,
    `STR:${player.strength}  INT:${player.intelligence}  HP:${player.constitution}  🧪${player.healthPotions}`,
    {
      x: barX,
      y: y2 + barH + PLAYER_BLOCK_STATS_Y_OFFSET,
      size: PLAYER_BLOCK_TEXT_SIZE,
      color: '#cbd5e1',
    },
  );

  // Status effect badges (Burn, Frozen, Paralyzed, …)
  if (player.statusEffects.length > 0) {
    let iconX = barX;
    for (const effect of player.statusEffects) {
      drawStatusIcon(ctx, effect, iconX, y2 + barH + STATUS_ICON_ROW_Y_OFFSET);
      iconX += STATUS_ICON_NEXT_X_OFFSET;
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
  const pillW = STATUS_ICON_PILL_W;
  const pillH = STATUS_ICON_PILL_H;

  let bgColor = '#6b7280';
  let label = effect.type.toUpperCase().slice(0, STATUS_ICON_LABEL_CHAR_LIMIT);

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
  drawText(ctx, label, {
    x: x + STATUS_ICON_LABEL_X_OFFSET,
    y: y + STATUS_ICON_LABEL_Y_OFFSET,
    bold: true,
    size: STATUS_ICON_LABEL_SIZE,
    color: '#fff',
  });

  // Duration bar (white strip across the bottom of the pill)
  const ratio = effect.ticksRemaining / effect.totalTicks;
  drawProgressBar(ctx, {
    x: x + 1,
    y: y + pillH - STATUS_ICON_BAR_Y_OFFSET,
    width: pillW - STATUS_ICON_BAR_W,
    height: 2,
    value: ratio,
    fill: 'rgba(255,255,255,0.85)',
    background: 'rgba(0,0,0,0.4)',
  });
}

/**
 * Gold skill-point notification badge rendered below the HUD panel.
 * Much larger and visually distinct from the panel above it.
 * Returns the stable click rect if visible, else HIDDEN_RECT.
 */
function renderNotification(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  human: Player,
  cat: Player,
  pulseRef: { value: number },
): HudRect {
  if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) return HIDDEN_RECT;

  pulseRef.value = (pulseRef.value + BADGE_PULSE_INCREMENT) % (Math.PI * 2);
  const pulse = PULSE_BASE + PULSE_AMPLITUDE * Math.sin(pulseRef.value);
  const bounceY = Math.round(Math.sin(pulseRef.value * NOTIF_BOUNCE_FREQ) * NOTIF_BOUNCE_AMP);

  // On mobile, cap width so the banner stays left of the minimap
  const notifW = platform.showHudCollapseToggle
    ? Math.min(
        NOTIF_WIDTH_FULL,
        Math.max(
          NOTIF_WIDTH_MIN,
          canvas.width - BADGE_MINIMAP_MARGIN - BADGE_MINIMAP_WIDTH - BADGE_MINIMAP_GAP,
        ),
      )
    : NOTIF_WIDTH_FULL;

  // Stable rect for hit testing; draw at bounceY offset
  const rect: HudRect = { x: PANEL_START_X, y: NOTIF_Y, w: notifW, h: NOTIF_H };
  const drawY = rect.y + bounceY;

  ctx.save();
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = NOTIF_SHADOW_BLUR_BASE + NOTIF_SHADOW_BLUR_PULSE * pulse;

  // Dark amber background
  ctx.fillStyle = NOTIF_FILL;
  ctx.fillRect(rect.x, drawY, rect.w, rect.h);

  // Gold border — thicker when pulsing
  ctx.strokeStyle = `rgba(251,191,36,${NOTIF_BORDER_BASE_ALPHA + NOTIF_BORDER_PULSE_ALPHA * pulse})`;
  ctx.lineWidth = 2 + pulse;
  ctx.strokeRect(rect.x, drawY, rect.w, rect.h);

  ctx.shadowBlur = 0;
  ctx.restore();

  // Large star icon
  ctx.save();
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(251,191,36,${NOTIF_ICON_COLOR_MIN_ALPHA + NOTIF_ICON_COLOR_PULSE_ALPHA * pulse})`;
  ctx.fillText('★', rect.x + NOTIF_ICON_X, drawY + NOTIF_ICON_Y);
  ctx.textAlign = 'left';
  ctx.restore();

  // "SKILL POINTS AVAILABLE" header
  drawText(ctx, 'SKILL POINTS AVAILABLE', {
    x: rect.x + NOTIF_TEXT_X,
    y: drawY + NOTIF_TEXT_Y,
    size: NOTIF_TEXT_SIZE,
    bold: true,
    color: `rgba(251,191,36,${NOTIF_TEXT_COLOR_MIN_ALPHA + NOTIF_TEXT_COLOR_PULSE_ALPHA * pulse})`,
  });

  // Sub-label
  drawText(ctx, platform.skillPointBanner, {
    x: rect.x + NOTIF_TEXT_X,
    y: drawY + NOTIF_SUB_Y,
    size: NOTIF_SUB_SIZE,
    color: `rgba(253,230,138,${NOTIF_SUB_COLOR_MIN_ALPHA + NOTIF_SUB_COLOR_PULSE_ALPHA * pulse})`,
  });

  // Clickable chevron
  drawText(ctx, '▶', {
    x: rect.x + rect.w - NOTIF_CHEVRON_X_OFFSET,
    y: drawY + NOTIF_CHEVRON_Y,
    size: NOTIF_CHEVRON_SIZE,
    bold: true,
    color: `rgba(251,191,36,${NOTIF_CHEVRON_COLOR_MIN_ALPHA + NOTIF_CHEVRON_COLOR_PULSE_ALPHA * pulse})`,
    align: 'center',
  });

  return rect;
}
