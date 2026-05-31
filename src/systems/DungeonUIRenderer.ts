/**
 * DungeonUIRenderer — stateless rendering functions extracted from DungeonScene.
 * Each function is a pure draw call with no side effects on game state.
 */

import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MobileTouchState } from '../core/MobileTouchState';
import type { CompanionSystem } from './CompanionSystem';
import type { MongoSystem } from './MongoSystem';
import type { InventoryPanel } from '../ui/InventoryPanel';
import type { GearPanel } from '../ui/GearPanel';
import type { PlayerManager } from '../core/PlayerManager';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';

export type Rect = { x: number; y: number; w: number; h: number };

const RIGHT_COL_MARGIN = 8;
const MINIMAP_Y = 8;
const BELOW_MAP_GAP = 20;
const DESKTOP_BTN_W = 104;
const MOBILE_BTN_W = 80;
const PAUSE_BTN_H = 28;
const TIMER_W = 96;
const TIMER_H = 42;
const TIMER_PAUSE_GAP = 8;

// Health vignette thresholds
const VIGNETTE_HEALTH_THRESHOLD = 0.25;
const CRITICAL_HEALTH_THRESHOLD = 0.1;
const LOW_HEALTH_THRESHOLD = 0.1;
const LOW_HEALTH_OPACITY_BASE = 0.3;
const LOW_HEALTH_OPACITY_WAVE = 0.45;
const MEDIUM_HEALTH_OPACITY_BASE = 0.1;
const MEDIUM_HEALTH_OPACITY_WAVE = 0.25;
const HEALTH_RATIO_RANGE = 0.15;
const HEALTH_WAVE_PERIOD = 120;
const HEALTH_WAVE_OFFSET = 0.5;
const HEALTH_WAVE_AMPLITUDE = 0.5;
const ALPHA_PRECISION_DIGITS = 3;

// Vignette gradient radii
const VIGNETTE_INNER_RADIUS_MULT = 0.25;
const VIGNETTE_OUTER_RADIUS_MULT = 0.85;

// Timer related
const SECONDS_PER_MINUTE = 60;
const URGENT_SECONDS_THRESHOLD = 60;
const WARNING_SECONDS_THRESHOLD = 300;
const URGENT_OPACITY = 0.85;
const URGENT_WAVE_PERIOD = 160;
const URGENT_WAVE_AMP = 0.12;
const WARNING_OPACITY = 0.85;
const NORMAL_OPACITY = 0.65;
const NON_URGENT_ALPHA = 0.75;

// Level up flash
const LEVEL_UP_FLASH_DURATION = 120;
const LEVEL_UP_RISE_DISTANCE = 28;
const LEVEL_UP_Y_OFFSET = 12;
const LEVEL_UP_TEXT_SIZE = 13;
const LEVEL_UP_TEXT_Y_RISE = 10;

// Tooltip styling
const TOOLTIP_PAD = 8;
const TOOLTIP_LINE_GAP = 4;
const TOOLTIP_NAME_SIZE = 13;
const TOOLTIP_DESC_SIZE = 11;
const TOOLTIP_OFFSET_X = 12;
const TOOLTIP_OFFSET_Y = 8;
const TOOLTIP_MARGIN_Y = 20;
const TOOLTIP_MARGIN_X = 4;
const TOOLTIP_CORNER_RADIUS = 4;
const TOOLTIP_BORDER_WIDTH = 1.5;
const TOOLTIP_ALPHA = 0.88;
const TOOLTIP_NAME_Y_ADJUST = 10;
const TOOLTIP_DESC_Y_ADJUST = 9;

// Mobile buttons
const SLOT_HEIGHT = 52;
const BOTTOM_MARGIN = 12;
const MOBILE_BTN_H = 52;
const MOBILE_BTN_MARGIN = 10;
const MOBILE_BTN_BOTTOM_OFFSET = 8;
const MOBILE_ACHIEVE_ICON_H = 26;
const MOBILE_ACHIEVE_GAP = 6;
const MOBILE_INVALID_X = -9999;
const MOBILE_GEAR_BTN_RECT_Y = 0;
const MOBILE_GEAR_BTN_RECT_W = 0;
const MOBILE_GEAR_BTN_RECT_H = 0;
const MOBILE_FOLLOWER_TEXT_Y = 30;
const MOBILE_FOLLOWER_TEXT_SIZE = 10;
const MOBILE_FOLLOWER_FONT_SIZE = 22;
const MOBILE_FOLLOWER_Y_OFFSET = 14;
const MOBILE_BUTTON_TEXT_Y_OFFSET = 6;
const MOBILE_BUTTON_TEXT_Y_OFFSET_2 = 7;
const MOBILE_BUTTON_ICON_Y_OFFSET = 2;
const MOBILE_BUTTON_ICON_FONT_SIZE = 20;
const MOBILE_BUTTON_GAP = 6;

/** Width of the right-column pause/bag buttons for the current platform. */
function rightColBtnW(): number {
  return platform.isMobile ? MOBILE_BTN_W : DESKTOP_BTN_W;
}

/** Compute the pause button rectangle based on minimap size. */
export function pauseButtonRect(canvas: HTMLCanvasElement, miniMap: MiniMapSystem): Rect {
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const w = rightColBtnW();
  const followerOffset = platform.isMobile
    ? TIMER_H + MOBILE_BUTTON_GAP + MOBILE_BTN_H + MOBILE_BUTTON_GAP
    : 0;
  return {
    x: canvas.width - RIGHT_COL_MARGIN - w,
    y: MINIMAP_Y + mmSize + BELOW_MAP_GAP + followerOffset,
    w,
    h: PAUSE_BTN_H,
  };
}

export function drawPauseButton(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  miniMap: MiniMapSystem,
  gameOver: boolean,
  pauseOpen: boolean,
): void {
  if (gameOver || pauseOpen) return;
  const pb = pauseButtonRect(canvas, miniMap);
  drawButton(ctx, {
    x: pb.x,
    y: pb.y,
    width: pb.w,
    height: pb.h,
    label: platform.pauseButtonLabel,
    sound: 'menu_open',
    ...BUTTON_PRESETS.toggle,
  });
}

export function renderHealthVignette(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  activePlayer: Player,
  gameOver: boolean,
): void {
  if (gameOver) return;
  const ratio = activePlayer.hp / activePlayer.maxHp;
  if (ratio >= VIGNETTE_HEALTH_THRESHOLD) return;

  const cw = canvas.width;
  const ch = canvas.height;

  let alpha: number;
  if (ratio < CRITICAL_HEALTH_THRESHOLD) {
    alpha =
      LOW_HEALTH_OPACITY_BASE +
      LOW_HEALTH_OPACITY_WAVE *
        (HEALTH_WAVE_OFFSET + HEALTH_WAVE_AMPLITUDE * Math.sin(Date.now() / HEALTH_WAVE_PERIOD));
  } else {
    alpha =
      MEDIUM_HEALTH_OPACITY_BASE +
      MEDIUM_HEALTH_OPACITY_WAVE * (1 - (ratio - LOW_HEALTH_THRESHOLD) / HEALTH_RATIO_RANGE);
  }

  const grad = ctx.createRadialGradient(
    cw / 2,
    ch / 2,
    Math.min(cw, ch) * VIGNETTE_INNER_RADIUS_MULT,
    cw / 2,
    ch / 2,
    Math.max(cw, ch) * VIGNETTE_OUTER_RADIUS_MULT,
  );
  grad.addColorStop(0, 'rgba(220,0,0,0)');
  grad.addColorStop(1, `rgba(220,0,0,${alpha.toFixed(ALPHA_PRECISION_DIGITS)})`);

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

export function renderLevelTimer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  miniMap: MiniMapSystem,
  timerFrames: number,
): void {
  const totalSec = Math.max(0, Math.ceil(timerFrames / SECONDS_PER_MINUTE));
  const min = Math.floor(totalSec / SECONDS_PER_MINUTE);
  const sec = totalSec % SECONDS_PER_MINUTE;
  const display = `${min}:${sec.toString().padStart(2, '0')}`;

  const urgent = totalSec <= URGENT_SECONDS_THRESHOLD;
  const warning = totalSec <= WARNING_SECONDS_THRESHOLD;

  const w = TIMER_W;
  const h = TIMER_H;
  let x: number;
  let y: number;
  if (platform.isMobile) {
    const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
    x = canvas.width - RIGHT_COL_MARGIN - w;
    y = MINIMAP_Y + mmSize + BELOW_MAP_GAP;
  } else {
    const pauseBtn = pauseButtonRect(canvas, miniMap);
    x = pauseBtn.x - TIMER_PAUSE_GAP - w;
    y = pauseBtn.y;
  }

  const urgentAlpha = urgent
    ? URGENT_OPACITY + Math.sin(Date.now() / URGENT_WAVE_PERIOD) * URGENT_WAVE_AMP
    : NON_URGENT_ALPHA;
  ctx.fillStyle = urgent
    ? `rgba(100,0,0,${urgentAlpha})`
    : warning
      ? `rgba(80,40,0,${WARNING_OPACITY})`
      : `rgba(0,0,0,${NORMAL_OPACITY})`;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = urgent ? '#ef4444' : warning ? '#f59e0b' : '#475569';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  const labelTopPad = 5;
  const displayTopOffset = 17;
  drawText(ctx, 'TIME REMAINING', {
    x: x + w / 2,
    y: y + labelTopPad,
    size: 9,
    color: '#94a3b8',
    align: 'center',
  });
  drawText(ctx, display, {
    x: x + w / 2,
    y: y + displayTopOffset,
    size: 17,
    bold: true,
    color: urgent ? '#f87171' : warning ? '#fbbf24' : '#e2e8f0',
    align: 'center',
  });
}

export function renderLevelUpFlash(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  pm: PlayerManager,
): void {
  for (const p of pm.players()) {
    if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
    const alpha = p.levelUpFlash / LEVEL_UP_FLASH_DURATION;
    const rise = (1 - alpha) * LEVEL_UP_RISE_DISTANCE;
    const sx = p.x - camX + TILE_SIZE / 2;
    const sy = p.y - camY - LEVEL_UP_Y_OFFSET - rise;
    drawText(ctx, `LEVEL UP! +${p.levelUpStat}`, {
      x: sx,
      y: sy - LEVEL_UP_TEXT_Y_RISE,
      size: LEVEL_UP_TEXT_SIZE,
      bold: true,
      color: '#facc15',
      alpha,
      align: 'center',
    });
  }
}

export function renderEntityTooltip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camX: number,
  camY: number,
  mouseX: number,
  mouseY: number,
  mobs: Mob[],
): void {
  const wx = mouseX + camX;
  const wy = mouseY + camY;

  let hovered: Mob | null = null;
  for (const mob of mobs) {
    if (!mob.isAlive) continue;
    if (wx >= mob.x && wx <= mob.x + TILE_SIZE && wy >= mob.y && wy <= mob.y + TILE_SIZE) {
      hovered = mob;
      break;
    }
  }

  if (!hovered) return;

  const name = hovered.displayName;
  const desc = hovered.description;

  ctx.font = 'bold 13px sans-serif';
  const nameW = ctx.measureText(name).width;
  ctx.font = '11px sans-serif';
  const descW = ctx.measureText(desc).width;
  const boxW = Math.max(nameW, descW) + TOOLTIP_PAD * 2;
  const boxH = TOOLTIP_NAME_SIZE + TOOLTIP_LINE_GAP + TOOLTIP_DESC_SIZE + TOOLTIP_PAD * 2;

  let tx = mouseX + TOOLTIP_OFFSET_X;
  let ty = mouseY - boxH - TOOLTIP_OFFSET_Y;
  if (tx + boxW > canvas.width - TOOLTIP_MARGIN_X) tx = canvas.width - boxW - TOOLTIP_MARGIN_X;
  if (ty < TOOLTIP_MARGIN_X) ty = mouseY + TOOLTIP_MARGIN_Y;

  ctx.save();
  ctx.globalAlpha = TOOLTIP_ALPHA;
  ctx.fillStyle = '#1a1a2e';
  ctx.strokeStyle = hovered.isHostile ? '#ef4444' : '#4ade80';
  ctx.lineWidth = TOOLTIP_BORDER_WIDTH;
  ctx.beginPath();
  ctx.roundRect(tx, ty, boxW, boxH, TOOLTIP_CORNER_RADIUS);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawText(ctx, name, {
    x: tx + TOOLTIP_PAD,
    y: ty + TOOLTIP_PAD + TOOLTIP_NAME_SIZE - TOOLTIP_NAME_Y_ADJUST,
    size: TOOLTIP_NAME_SIZE,
    bold: true,
    font: 'sans-serif',
    color: hovered.isHostile ? '#fca5a5' : '#86efac',
  });

  if (desc) {
    drawText(ctx, desc, {
      x: tx + TOOLTIP_PAD,
      y:
        ty +
        TOOLTIP_PAD +
        TOOLTIP_NAME_SIZE +
        TOOLTIP_LINE_GAP +
        TOOLTIP_DESC_SIZE -
        TOOLTIP_DESC_Y_ADJUST,
      size: TOOLTIP_DESC_SIZE,
      font: 'sans-serif',
      color: '#d1d5db',
    });
  }
}

export interface MobileButtonState {
  human: HumanPlayer;
  cat: CatPlayer;
  miniMap: MiniMapSystem;
  companion: CompanionSystem;
  mongoSystem: MongoSystem;
  inventoryPanel: InventoryPanel;
  gearPanel: GearPanel;
  hideSwitchButton?: boolean;
  hideFollowerButton?: boolean;
}

export function renderMobileButtons(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  touch: MobileTouchState,
  state: MobileButtonState,
): void {
  const btnY =
    canvas.height - SLOT_HEIGHT - BOTTOM_MARGIN - MOBILE_BTN_H - MOBILE_BTN_BOTTOM_OFFSET;

  touch.switchBtnRect = { x: MOBILE_BTN_MARGIN, y: btnY, w: MOBILE_BTN_W, h: MOBILE_BTN_H };

  const mmSize = state.miniMap.isExpanded ? state.miniMap.EXPANDED_SIZE : state.miniMap.NORMAL_SIZE;
  const rightX = canvas.width - MOBILE_BTN_W - RIGHT_COL_MARGIN;
  const followerY = MINIMAP_Y + mmSize + BELOW_MAP_GAP + TIMER_H + MOBILE_BUTTON_GAP;
  const followerRect: Rect = { x: rightX, y: followerY, w: MOBILE_BTN_W, h: MOBILE_BTN_H };
  const pauseY = followerY + MOBILE_BTN_H + MOBILE_BUTTON_GAP;
  const bagY =
    pauseY + PAUSE_BTN_H + MOBILE_ACHIEVE_GAP + MOBILE_ACHIEVE_ICON_H + MOBILE_ACHIEVE_GAP;
  touch.gearBtnRect = {
    x: MOBILE_INVALID_X,
    y: MOBILE_GEAR_BTN_RECT_Y,
    w: MOBILE_GEAR_BTN_RECT_W,
    h: MOBILE_GEAR_BTN_RECT_H,
  };
  touch.bagBtnRect = { x: rightX, y: bagY, w: MOBILE_BTN_W, h: PAUSE_BTN_H };

  const drawBtn = (r: Rect, icon: string, label: string, active: boolean) => {
    drawButton(ctx, {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      label: '',
      ...(active ? BUTTON_PRESETS.mobileActive : BUTTON_PRESETS.mobile),
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${MOBILE_BUTTON_ICON_FONT_SIZE}px monospace`;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(icon, r.x + r.w / 2, r.y + r.h / 2 + MOBILE_BUTTON_ICON_Y_OFFSET);
    ctx.textAlign = 'left';
    ctx.restore();
    drawText(ctx, label, {
      x: r.x + r.w / 2,
      y: r.y + r.h - MOBILE_BUTTON_TEXT_Y_OFFSET - MOBILE_BUTTON_TEXT_Y_OFFSET_2,
      size: 9,
      color: '#94a3b8',
      align: 'center',
    });
  };

  const drawSmallBtn = (r: Rect, label: string, active: boolean) => {
    drawButton(ctx, {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      label,
      ...(active ? BUTTON_PRESETS.mobileSmallActive : BUTTON_PRESETS.mobileSmall),
    });
  };

  const humanActive = state.human.isActive;
  if (!state.hideSwitchButton) {
    drawBtn(touch.switchBtnRect, humanActive ? '🐱' : '🧍', humanActive ? 'Cat' : 'Human', false);
  }
  if (!state.hideFollowerButton) {
    renderFollowerButton(ctx, canvas, touch, state.companion, humanActive, followerRect);
  }
  drawSmallBtn(touch.bagBtnRect, 'Bag', state.inventoryPanel.isOpen);

  // Mongo summon button — above the switch button when cat is active
  if (state.mongoSystem.canShow && state.cat.isActive) {
    const summonY = btnY - MOBILE_BTN_H - MOBILE_BUTTON_GAP;
    touch.summonBtnRect = state.mongoSystem.renderSummonButton(
      ctx,
      MOBILE_BTN_MARGIN,
      summonY,
      MOBILE_BTN_W,
      MOBILE_BTN_H,
      state.cat.isActive,
    );
  } else {
    touch.summonBtnRect = {
      x: MOBILE_INVALID_X,
      y: MOBILE_GEAR_BTN_RECT_Y,
      w: MOBILE_GEAR_BTN_RECT_W,
      h: MOBILE_GEAR_BTN_RECT_H,
    };
  }
}

/** Render the Follower button and write its rect to touch (works on both mobile and desktop). */
export function renderFollowerButton(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  touch: MobileTouchState,
  companion: CompanionSystem,
  humanIsActive: boolean,
  overrideRect?: Rect,
): void {
  const btnY =
    canvas.height - SLOT_HEIGHT - BOTTOM_MARGIN - MOBILE_BTN_H - MOBILE_BTN_BOTTOM_OFFSET;
  const r: Rect = overrideRect ?? {
    x: canvas.width - MOBILE_BTN_MARGIN - MOBILE_BTN_W,
    y: btnY,
    w: MOBILE_BTN_W,
    h: MOBILE_BTN_H,
  };
  touch.followBtnRect = r;

  const anchored = companion.getMovementMode(humanIsActive) === 'anchored';
  const passive = companion.getCombatStance(humanIsActive) === 'passive';
  const nonDefault = anchored || passive;

  drawButton(ctx, {
    x: r.x,
    y: r.y,
    width: r.w,
    height: r.h,
    label: '',
    ...(nonDefault ? BUTTON_PRESETS.mobileActive : BUTTON_PRESETS.mobile),
  });

  // Show which character is the companion
  const companionEmoji = humanIsActive ? '🐱' : '🧍';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `bold ${MOBILE_FOLLOWER_FONT_SIZE}px monospace`;
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(companionEmoji, r.x + r.w / 2, r.y + MOBILE_FOLLOWER_TEXT_Y);
  ctx.textAlign = 'left';
  ctx.restore();

  drawText(ctx, 'Follower', {
    x: r.x + r.w / 2,
    y: r.y + r.h - MOBILE_FOLLOWER_Y_OFFSET,
    size: MOBILE_FOLLOWER_TEXT_SIZE,
    bold: true,
    color: nonDefault ? '#facc15' : '#94a3b8',
    align: 'center',
  });
}
