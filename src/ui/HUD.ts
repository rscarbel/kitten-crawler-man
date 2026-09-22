import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { StatusEffect } from '../core/StatusEffect';
import { platform } from '../core/Platform';
import { drawText } from './TextBox';
import { drawBox, drawProgressBar } from './Box';
import { viewportWidth } from '../core/Viewport';
import { statusBadge } from '../sprites/status/statusEffectVisuals';

export type HudRect = { x: number; y: number; w: number; h: number };
type HudResult = {
  toggleRect: HudRect;
  notifRect: HudRect;
  hudPanelBottom: number;
  hudRect: HudRect;
};

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
const NOTIF_LINE_WIDTH_MIN = 2;
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

// Reminder-flagged constants — applied on top of the normal notification once
// the point has gone unspent long enough to nag about (see
// SkillPointReminderSystem). Growing the box around its own center keeps the
// stable click rect centered rather than shifting the whole banner.
const REMINDER_SIZE_SCALE = 1.45;
const REMINDER_SHADOW_BLUR_BOOST = 40;
const REMINDER_BORDER_ALPHA = 1;
const REMINDER_BORDER_LINE_WIDTH = 4;
/** Added to the mobile badge's normal border width while flagged. */
const REMINDER_LINE_WIDTH_BOOST = 2;
/** Faster, brighter oscillation layered on top of the base pulse's white flash. */
const REMINDER_FLASH_FREQ = 2.5;
const REMINDER_FLASH_ALPHA = 0.35;
// A soft aura drawn behind the box, sized off the box's own width so it scales
// with the banner (full-width desktop vs. the narrower mobile badge) rather
// than being a fixed radius that looks right on only one of them.
const REMINDER_GLOW_WIDTH_RATIO = 0.9;
const REMINDER_GLOW_RADIUS_PULSE = 24;
const REMINDER_GLOW_ALPHA_BASE = 0.3;
const REMINDER_GLOW_ALPHA_PULSE = 0.3;

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

// Status icon constants
const STATUS_ICON_PILL_W = 26;
const STATUS_ICON_PILL_H = 12;
const STATUS_ICON_LABEL_X_OFFSET = 2;
const STATUS_ICON_LABEL_Y_OFFSET = 2;
const STATUS_ICON_LABEL_SIZE = 7;
const STATUS_ICON_BAR_Y_OFFSET = 3;
const STATUS_ICON_BAR_W = 2;
/** Inset that keeps the pill's duration bar inside its 1px border. */
const STATUS_ICON_BAR_X_INSET = 1;
const STATUS_ICON_BAR_H = 2;
/** Cockroach pill: amber when armed, drab slate while the recharge runs. */
const COCKROACH_READY_COLOR = '#b45309';
const COCKROACH_RECHARGING_COLOR = '#334155';
/** Mobile collapsed HUD: the cockroach dot sits just left of the expand toggle. */
const COLLAPSED_COCKROACH_X_OFFSET = 26;
const COLLAPSED_COCKROACH_SIZE = 8;
const COLLAPSED_COCKROACH_Y_OFFSET = 6;
const STATUS_ICON_ROW_Y_OFFSET = 16;
const STATUS_ICON_NEXT_X_OFFSET = 30;
const STATUS_ICON_HARMFUL_BORDER = 'rgba(20, 6, 6, 0.85)';
const STATUS_ICON_BOON_BORDER = 'rgba(255, 255, 255, 0.7)';
const STATUS_ICON_BORDER_WIDTH = 1.5;

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
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
  collapsed = false,
  reminderActive = false,
): HudResult {
  if (platform.showHudCollapseToggle && collapsed) {
    return drawHUDCollapsed(ctx, human, cat, pulseRef);
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

  const notifRect = renderNotification(ctx, human, cat, pulseRef, reminderActive);
  const hudPanelBottom = panelTopY + panelHeight;
  const hudRect: HudRect = { x: PANEL_START_X, y: panelTopY, w: PANEL_WIDTH, h: panelHeight };

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
    return { toggleRect, notifRect, hudPanelBottom, hudRect };
  }
  return { toggleRect: HIDDEN_RECT, notifRect, hudPanelBottom, hudRect };
}

/** Compact single-row HUD for mobile collapsed state. Does not render the skill badge. */
function drawHUDCollapsed(
  ctx: CanvasRenderingContext2D,
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

  // Cockroach state, reduced to a dot: the collapsed bar has no room for a pill,
  // but whether the cat's one free death is armed still matters at a glance.
  if (cat.skills.isUnlocked('cockroach')) {
    drawBox(ctx, {
      x: x + COLLAPSED_TOGGLE_X_OFFSET - COLLAPSED_COCKROACH_X_OFFSET,
      y: y + COLLAPSED_COCKROACH_Y_OFFSET,
      width: COLLAPSED_COCKROACH_SIZE,
      height: COLLAPSED_COCKROACH_SIZE,
      fill: cat.isCockroachReady ? COCKROACH_READY_COLOR : COCKROACH_RECHARGING_COLOR,
    });
  }

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
  const hudRect: HudRect = { x, y, w: BAR_W + TOGGLE_BTN_W, h: BAR_H };
  return { toggleRect, notifRect: HIDDEN_RECT, hudPanelBottom: y + BAR_H, hudRect };
}

/**
 * Renders the mobile skill-points badge at the given `topY`.
 * Call this after any boss/arena UI so the badge stacks below them.
 * Returns the badge rect for hit-testing, or HIDDEN_RECT if no unspent points.
 */
export function renderMobileSkillBadge(
  ctx: CanvasRenderingContext2D,
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
  topY: number,
  reminderActive = false,
): HudRect {
  const hasUnspent = human.unspentPoints > 0 || cat.unspentPoints > 0;
  if (!hasUnspent) return HIDDEN_RECT;

  pulseRef.value = (pulseRef.value + BADGE_PULSE_INCREMENT) % (Math.PI * 2);
  const pulse = PULSE_BASE + PULSE_AMPLITUDE * Math.sin(pulseRef.value);

  // Cap width so the badge doesn't overlap the minimap
  const badgeMaxW = Math.min(
    BADGE_MAX_W,
    viewportWidth() - BADGE_MINIMAP_MARGIN - BADGE_MINIMAP_WIDTH - BADGE_MINIMAP_GAP,
  );
  const badgeRect: HudRect = { x: BADGE_X, y: topY, w: badgeMaxW, h: BADGE_H };

  // Same grow/glow/flash treatment as the desktop notification (see
  // renderNotification and reminderGrowthCenter).
  const scale = reminderActive ? REMINDER_SIZE_SCALE : 1;
  const { pivotX, finalCenterX, finalCenterY } = reminderGrowthCenter(
    badgeRect,
    scale,
    reminderActive,
  );

  ctx.save();
  if (reminderActive) {
    drawReminderGlow(ctx, finalCenterX, finalCenterY, badgeRect.w, pulseRef.value);
    ctx.translate(pivotX, finalCenterY);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -finalCenterY);
  }

  const badgeLineWidth = reminderActive
    ? BADGE_LINE_WIDTH_MIN + REMINDER_LINE_WIDTH_BOOST + pulse * BADGE_LINE_WIDTH_PULSE_MULT
    : BADGE_LINE_WIDTH_MIN + pulse * BADGE_LINE_WIDTH_PULSE_MULT;
  drawReminderBox(ctx, badgeRect, pulse, pulseRef.value, reminderActive, badgeLineWidth, {
    fill: BADGE_FILL_RGB,
    shadowBlurBase: BADGE_SHADOW_BLUR,
    shadowBlurPulseMult: BADGE_PULSE_SHADOW_MULT,
    borderBaseAlpha: BADGE_BORDER_BASE_ALPHA,
    borderPulseAlpha: BADGE_BORDER_PULSE_ALPHA,
  });

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

  ctx.restore(); // pops the reminder growth transform (a no-op transform when not flagged)

  if (!reminderActive) return badgeRect;
  return {
    x: finalCenterX - (badgeRect.w * scale) / 2,
    y: finalCenterY - (badgeRect.h * scale) / 2,
    w: badgeRect.w * scale,
    h: badgeRect.h * scale,
  };
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
  const xpNeeded = player.xpNeededForNextLevel;
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
    `STR:${player.strength}  INT:${player.intelligence}  HP:${player.constitution}  DEX:${player.dexterity}  🧪${player.healthPotions}`,
    {
      x: barX,
      y: y2 + barH + PLAYER_BLOCK_STATS_Y_OFFSET,
      size: PLAYER_BLOCK_TEXT_SIZE,
      color: '#cbd5e1',
    },
  );

  // Status effect badges (Burn, Frozen, Paralyzed, …), then the persistent
  // Cockroach pill — a standing capability rather than a timed effect, so it
  // sits at the end of the row and stays there once the skill is known.
  let iconX = barX;
  for (const effect of player.statusEffects) {
    drawStatusIcon(ctx, effect, iconX, y2 + barH + STATUS_ICON_ROW_Y_OFFSET);
    iconX += STATUS_ICON_NEXT_X_OFFSET;
  }
  if (player.skills.isUnlocked('cockroach')) {
    drawCockroachPill(ctx, player, iconX, y2 + barH + STATUS_ICON_ROW_Y_OFFSET);
  }
}

/**
 * Cockroach's readiness pill: solid amber when it can save you, drained and
 * refilling by wall-clock fraction while it recharges.
 */
function drawCockroachPill(
  ctx: CanvasRenderingContext2D,
  player: HumanPlayer | CatPlayer,
  x: number,
  y: number,
): void {
  const ready = player.isCockroachReady;
  drawBox(ctx, {
    x,
    y,
    width: STATUS_ICON_PILL_W,
    height: STATUS_ICON_PILL_H,
    fill: ready ? COCKROACH_READY_COLOR : COCKROACH_RECHARGING_COLOR,
  });
  drawText(ctx, 'ROACH', {
    x: x + STATUS_ICON_LABEL_X_OFFSET,
    y: y + STATUS_ICON_LABEL_Y_OFFSET,
    bold: true,
    size: STATUS_ICON_LABEL_SIZE,
    color: ready ? '#fff' : '#cbd5e1',
  });
  drawProgressBar(ctx, {
    x: x + STATUS_ICON_BAR_X_INSET,
    y: y + STATUS_ICON_PILL_H - STATUS_ICON_BAR_Y_OFFSET,
    width: STATUS_ICON_PILL_W - STATUS_ICON_BAR_W,
    height: STATUS_ICON_BAR_H,
    value: player.cockroachRechargeFraction(),
    fill: ready ? 'rgba(255,255,255,0.85)' : COCKROACH_READY_COLOR,
    background: 'rgba(0,0,0,0.4)',
  });
}

/**
 * Renders a single status-effect badge: a coloured pill with a short label and
 * a small duration bar across the bottom.
 *
 * Label and colour come from the status-visual registry rather than a branch
 * chain here, so a badge can never disagree with the effect drawn on the
 * character. Adding a status means adding it there.
 */
function drawStatusIcon(ctx: CanvasRenderingContext2D, effect: StatusEffect, x: number, y: number) {
  const pillW = STATUS_ICON_PILL_W;
  const pillH = STATUS_ICON_PILL_H;
  const badge = statusBadge(effect.type);

  // A harmful badge carries a dark outline and a beneficial one a bright rim, so
  // the two are separable at a glance without reading four letters of text.
  drawBox(ctx, {
    x,
    y,
    width: pillW,
    height: pillH,
    fill: badge.color,
    border: badge.harmful ? STATUS_ICON_HARMFUL_BORDER : STATUS_ICON_BOON_BORDER,
    borderWidth: STATUS_ICON_BORDER_WIDTH,
  });

  // Label
  drawText(ctx, badge.label, {
    x: x + STATUS_ICON_LABEL_X_OFFSET,
    y: y + STATUS_ICON_LABEL_Y_OFFSET,
    bold: true,
    size: STATUS_ICON_LABEL_SIZE,
    color: '#fff',
  });

  // Duration bar (white strip across the bottom of the pill)
  const ratio = effect.ticksRemaining / effect.totalTicks;
  drawProgressBar(ctx, {
    x: x + STATUS_ICON_BAR_X_INSET,
    y: y + pillH - STATUS_ICON_BAR_Y_OFFSET,
    width: pillW - STATUS_ICON_BAR_W,
    height: STATUS_ICON_BAR_H,
    value: ratio,
    fill: 'rgba(255,255,255,0.85)',
    background: 'rgba(0,0,0,0.4)',
  });
}

/**
 * Soft radial aura drawn behind a reminder-flagged skill-point box, sized off
 * the box's own width and pulsing independently of the box's own
 * grow/flash/border pulse — the glow a flagged box needs to be seen from
 * across a busy HUD, not just brighter at the edges.
 */
function drawReminderGlow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  boxWidth: number,
  pulseValue: number,
): void {
  const glowPulse = PULSE_BASE + PULSE_AMPLITUDE * Math.sin(pulseValue * REMINDER_FLASH_FREQ);
  const radius =
    (boxWidth * REMINDER_GLOW_WIDTH_RATIO) / 2 + REMINDER_GLOW_RADIUS_PULSE * glowPulse;
  const alpha = REMINDER_GLOW_ALPHA_BASE + REMINDER_GLOW_ALPHA_PULSE * glowPulse;
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, `rgba(251,191,36,${alpha})`);
  gradient.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * Fill, border and reminder-flash pass shared by the notification banner and
 * the mobile skill badge — everything inside their `ctx.save()`/`ctx.restore()`
 * pair once the growth transform (if any) is already applied.
 */
function drawReminderBox(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  pulse: number,
  pulsePhase: number,
  reminderActive: boolean,
  lineWidth: number,
  style: {
    fill: string;
    shadowBlurBase: number;
    shadowBlurPulseMult: number;
    borderBaseAlpha: number;
    borderPulseAlpha: number;
  },
): void {
  ctx.save();
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur =
    style.shadowBlurBase +
    style.shadowBlurPulseMult * pulse +
    (reminderActive ? REMINDER_SHADOW_BLUR_BOOST : 0);
  ctx.fillStyle = style.fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = reminderActive
    ? `rgba(251,191,36,${REMINDER_BORDER_ALPHA})`
    : `rgba(251,191,36,${style.borderBaseAlpha + style.borderPulseAlpha * pulse})`;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  if (reminderActive) {
    const flashAlpha =
      REMINDER_FLASH_ALPHA * Math.max(0, Math.sin(pulsePhase * REMINDER_FLASH_FREQ));
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * Transform pivot and final on-screen center for a box that, while flagged,
 * grows toward the horizontal center of the viewport instead of around its
 * own position. Both the notification banner and the mobile badge are anchored
 * near the left edge, so growing 45% around their own center pushes the added
 * width straight off the left of the screen — this solves for the pivot that
 * lands the box's own geometry exactly on the viewport's horizontal center
 * once scaled: `pivot + scale * (own - pivot) = final`.
 */
function reminderGrowthCenter(
  drawnRect: HudRect,
  scale: number,
  reminderActive: boolean,
): { pivotX: number; finalCenterX: number; finalCenterY: number } {
  const ownCenterX = drawnRect.x + drawnRect.w / 2;
  const finalCenterY = drawnRect.y + drawnRect.h / 2;
  const finalCenterX = reminderActive ? viewportWidth() / 2 : ownCenterX;
  const pivotX = reminderActive ? (finalCenterX - scale * ownCenterX) / (1 - scale) : ownCenterX;
  return { pivotX, finalCenterX, finalCenterY };
}

/**
 * Gold skill-point notification badge rendered below the HUD panel.
 * Much larger and visually distinct from the panel above it.
 * Returns the stable click rect if visible, else HIDDEN_RECT.
 */
function renderNotification(
  ctx: CanvasRenderingContext2D,
  human: Player,
  cat: Player,
  pulseRef: { value: number },
  reminderActive = false,
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
          viewportWidth() - BADGE_MINIMAP_MARGIN - BADGE_MINIMAP_WIDTH - BADGE_MINIMAP_GAP,
        ),
      )
    : NOTIF_WIDTH_FULL;

  // Stable rect for hit testing; draw at bounceY offset
  const rect: HudRect = { x: PANEL_START_X, y: NOTIF_Y, w: notifW, h: NOTIF_H };
  const drawY = rect.y + bounceY;

  // Once flagged by SkillPointReminderSystem, everything below is drawn inside
  // a transform that grows the whole banner toward the viewport's horizontal
  // center (see reminderGrowthCenter) — the banner is anchored near the left
  // edge, and growing around its own position would push the added width
  // straight off the screen.
  const scale = reminderActive ? REMINDER_SIZE_SCALE : 1;
  const { pivotX, finalCenterX, finalCenterY } = reminderGrowthCenter(
    { x: rect.x, y: drawY, w: rect.w, h: rect.h },
    scale,
    reminderActive,
  );

  ctx.save();
  if (reminderActive) {
    // Drawn before the growth transform below so the halo's own size and
    // pulse are independent of the box scaling up inside it.
    drawReminderGlow(ctx, finalCenterX, finalCenterY, rect.w, pulseRef.value);
    ctx.translate(pivotX, finalCenterY);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -finalCenterY);
  }

  // Gold border — thicker when pulsing, maxed out and pinned wide while flagged
  const notifLineWidth = reminderActive
    ? REMINDER_BORDER_LINE_WIDTH + pulse
    : NOTIF_LINE_WIDTH_MIN + pulse;
  drawReminderBox(
    ctx,
    { x: rect.x, y: drawY, w: rect.w, h: rect.h },
    pulse,
    pulseRef.value,
    reminderActive,
    notifLineWidth,
    {
      fill: NOTIF_FILL,
      shadowBlurBase: NOTIF_SHADOW_BLUR_BASE,
      shadowBlurPulseMult: NOTIF_SHADOW_BLUR_PULSE,
      borderBaseAlpha: NOTIF_BORDER_BASE_ALPHA,
      borderPulseAlpha: NOTIF_BORDER_PULSE_ALPHA,
    },
  );

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

  ctx.restore(); // pops the reminder growth transform (a no-op transform when not flagged)

  if (!reminderActive) return rect;
  // Hit rect grows with the drawn box so the enlarged banner stays clickable
  // exactly where it now visually sits.
  return {
    x: finalCenterX - (rect.w * scale) / 2,
    y: finalCenterY - (rect.h * scale) / 2,
    w: rect.w * scale,
    h: rect.h * scale,
  };
}
