/**
 * DungeonUIRenderer — stateless rendering functions for the dungeon HUD. Each
 * function is a pure draw call with no side effects on game state.
 */

import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MobileTouchState } from '../core/MobileTouchState';
import type { CompanionSystem } from './CompanionSystem';
import type { MongoSystem } from './MongoSystem';
import type { InventoryPanel } from '../ui/InventoryPanel';
import { hotbarStripRect } from '../ui/InventoryPanel';
import type { GearPanel } from '../ui/GearPanel';
import type { PlayerManager } from '../core/PlayerManager';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { drawCompassIcon } from '../ui/icons/compassIcon';
import { drawConstructionIcon } from '../ui/icons/constructionIcon';
import { keybindings } from '../core/Keybindings';
import { viewportWidth, viewportHeight } from '../core/Viewport';

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

// Vignette gradient radii
const VIGNETTE_INNER_RADIUS_MULT = 0.25;
const VIGNETTE_OUTER_RADIUS_MULT = 0.85;
const VIGNETTE_CENTER_COLOR = 'rgba(220,0,0,0)';
const VIGNETTE_EDGE_COLOR = 'rgba(220,0,0,1)';

let cachedVignette: CanvasGradient | null = null;
let cachedVignetteWidth = 0;
let cachedVignetteHeight = 0;

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
export function pauseButtonRect(miniMap: MiniMapSystem): Rect {
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const w = rightColBtnW();
  const followerOffset = platform.isMobile
    ? TIMER_H + MOBILE_BUTTON_GAP + MOBILE_BTN_H + MOBILE_BUTTON_GAP
    : 0;
  return {
    x: viewportWidth() - RIGHT_COL_MARGIN - w,
    y: MINIMAP_Y + mmSize + BELOW_MAP_GAP + followerOffset,
    w,
    h: PAUSE_BTN_H,
  };
}

export function drawPauseButton(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  gameOver: boolean,
  pauseOpen: boolean,
): void {
  if (gameOver || pauseOpen) return;
  const pb = pauseButtonRect(miniMap);
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
  activePlayer: Player,
  gameOver: boolean,
): void {
  if (gameOver) return;
  const ratio = activePlayer.hp / activePlayer.maxHp;
  if (ratio >= VIGNETTE_HEALTH_THRESHOLD) return;

  const cw = viewportWidth();
  const ch = viewportHeight();

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

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = vignetteGradient(ctx, cw, ch);
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

/**
 * The vignette covers the whole screen and is rebuilt only when the viewport
 * changes size: its shape is fixed and only its opacity varies, which
 * `globalAlpha` carries. Rebuilding it per frame meant allocating a
 * screen-sized gradient on every frame the player was hurt.
 */
function vignetteGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): CanvasGradient {
  if (cachedVignette !== null && cachedVignetteWidth === width && cachedVignetteHeight === height) {
    return cachedVignette;
  }
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * VIGNETTE_INNER_RADIUS_MULT,
    width / 2,
    height / 2,
    Math.max(width, height) * VIGNETTE_OUTER_RADIUS_MULT,
  );
  gradient.addColorStop(0, VIGNETTE_CENTER_COLOR);
  gradient.addColorStop(1, VIGNETTE_EDGE_COLOR);
  cachedVignette = gradient;
  cachedVignetteWidth = width;
  cachedVignetteHeight = height;
  return gradient;
}

/** Where the level's collapse timer stands, on floors that have one. */
export function levelTimerRect(miniMap: MiniMapSystem): Rect {
  if (platform.isMobile) {
    const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
    return {
      x: viewportWidth() - RIGHT_COL_MARGIN - TIMER_W,
      y: MINIMAP_Y + mmSize + BELOW_MAP_GAP,
      w: TIMER_W,
      h: TIMER_H,
    };
  }
  const pauseBtn = pauseButtonRect(miniMap);
  return { x: pauseBtn.x - TIMER_PAUSE_GAP - TIMER_W, y: pauseBtn.y, w: TIMER_W, h: TIMER_H };
}

export function renderLevelTimer(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  timerFrames: number,
): void {
  const totalSec = Math.max(0, Math.ceil(timerFrames / SECONDS_PER_MINUTE));
  const min = Math.floor(totalSec / SECONDS_PER_MINUTE);
  const sec = totalSec % SECONDS_PER_MINUTE;
  const display = `${min}:${sec.toString().padStart(2, '0')}`;

  const urgent = totalSec <= URGENT_SECONDS_THRESHOLD;
  const warning = totalSec <= WARNING_SECONDS_THRESHOLD;

  const { x, y, w, h } = levelTimerRect(miniMap);

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
  camX: number,
  camY: number,
  mouseX: number,
  mouseY: number,
  mobGrid: SpatialGrid<Mob>,
): void {
  const wx = mouseX + camX;
  const wy = mouseY + camY;

  // A mob can only be hovered when the cursor is inside its tile square, so
  // every candidate has its origin within that square's diagonal of the cursor.
  let hovered: Mob | null = null;
  for (const mob of mobGrid.queryCircle(wx, wy, TILE_SIZE * Math.SQRT2)) {
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
  if (tx + boxW > viewportWidth() - TOOLTIP_MARGIN_X)
    tx = viewportWidth() - boxW - TOOLTIP_MARGIN_X;
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
  touch: MobileTouchState,
  state: MobileButtonState,
): void {
  const btnY =
    viewportHeight() - SLOT_HEIGHT - BOTTOM_MARGIN - MOBILE_BTN_H - MOBILE_BTN_BOTTOM_OFFSET;

  touch.switchBtnRect = { x: MOBILE_BTN_MARGIN, y: btnY, w: MOBILE_BTN_W, h: MOBILE_BTN_H };

  const mmSize = state.miniMap.isExpanded ? state.miniMap.EXPANDED_SIZE : state.miniMap.NORMAL_SIZE;
  const rightX = viewportWidth() - MOBILE_BTN_W - RIGHT_COL_MARGIN;
  const followerY = MINIMAP_Y + mmSize + BELOW_MAP_GAP + TIMER_H + MOBILE_BUTTON_GAP;
  const followerRect: Rect = { x: rightX, y: followerY, w: MOBILE_BTN_W, h: MOBILE_BTN_H };
  const pauseY = followerY + MOBILE_BTN_H + MOBILE_BUTTON_GAP;
  const bagY = pauseY + PAUSE_BTN_H + MOBILE_BUTTON_GAP;
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
    renderFollowerButton(ctx, touch, state.companion, humanActive, followerRect);
  }
  drawSmallBtn(touch.bagBtnRect, 'Bag', state.inventoryPanel.isOpen);

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

/** The Bag button's slot, directly under Pause. */
const BAG_SLOTS_BELOW_PAUSE = 1;
/** The Build button's slot: directly under the Bag button. */
const BUILD_SLOTS_BELOW_PAUSE = 2;

/**
 * Whether the column holds the Build button's slot this frame. Only a map
 * where the button can appear reserves it; every other floor has no Build slot
 * in the column.
 */
let buildSlotReserved = false;

/** Called by the scene once a frame, before the column is laid out. */
export function setBuildSlotReserved(reserved: boolean): void {
  buildSlotReserved = reserved;
}

/** The Build button's icon, inset from the button's left edge. */
const BUILD_ICON_INSET = 4;
const BUILD_LABEL_GAP = 4;
const BUILD_LABEL_SIZE = 12;
/** How fast the Build button pulses when it first appears, in pulses per second. */
const BUILD_PULSE_HZ = 1.5;
const BUILD_PULSE_GLOW = '#fbbf24';

/** Where the Build button stands: under Bag, or beside the column when it won't fit. */
export function buildButtonRect(miniMap: MiniMapSystem): Rect {
  return columnLayout(miniMap).build;
}

/**
 * The Build button: the Construction menu's HUD entry. `pulseSeconds` counts
 * down the attention pulse it gets the first time it appears.
 */
export function drawBuildButton(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  menuOpen: boolean,
  pulseSeconds: number,
): Rect {
  const r = buildButtonRect(miniMap);
  const pulsing = pulseSeconds > 0 && Math.sin(pulseSeconds * Math.PI * 2 * BUILD_PULSE_HZ) > 0;
  drawButton(ctx, {
    x: r.x,
    y: r.y,
    width: r.w,
    height: r.h,
    label: '',
    sound: 'menu_open',
    ...(menuOpen || pulsing ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
    ...(pulsing ? { glow: BUILD_PULSE_GLOW } : {}),
  });
  const iconSize = r.h - BUILD_ICON_INSET * 2;
  drawConstructionIcon(ctx, r.x + BUILD_ICON_INSET, r.y + BUILD_ICON_INSET, iconSize);
  const label = platform.isMobile ? 'Build' : `Build [${keybindings.labelFor('construction')}]`;
  drawText(ctx, label, {
    x: r.x + BUILD_ICON_INSET + iconSize + BUILD_LABEL_GAP,
    y: r.y + (r.h - BUILD_LABEL_SIZE) / 2,
    size: BUILD_LABEL_SIZE,
    color: '#e2e8f0',
  });
  return r;
}

/**
 * The chip's own geometry, in the right-hand HUD column below the pause button.
 */
const CHIP_HEIGHT = 26;

/**
 * Where `AchievementUISystem`'s "🏆 NEW" chip stands when the party is not in a
 * safe room.
 *
 * Lives here rather than with the system that paints it, because it is a slot in
 * *this* module's column: everything else that column holds is measured here,
 * and the Journal has to know how far down it reaches. When the column has no
 * room it follows `columnLayout`'s fallback order.
 */
export function achievementChipRect(miniMap: MiniMapSystem): Rect {
  return columnLayout(miniMap).chip;
}

/** Whether the level's collapse timer is on screen this frame, which the column must keep clear of. */
let levelTimerShown = false;
/** The party's HUD panel, top left, which a spilled-over column piece must not land on. */
let hudPanelRect: Rect | null = null;

/** Called by the scene once a frame, before the column is laid out. */
export function setLevelTimerShown(shown: boolean): void {
  levelTimerShown = shown;
}

/** Called by the scene once the HUD panel has been drawn and measured. */
export function setHudPanelRect(rect: Rect | null): void {
  hudPanelRect = rect;
}

/** The unopened-loot-box banner, while it shows. */
let lootBoxBannerRect: Rect | null = null;

/** Called by the scene once a frame, before the column is laid out. */
export function setLootBoxBannerRect(rect: Rect | null): void {
  lootBoxBannerRect = rect;
}

/** Clears every piece of column layout state, for a scene starting fresh. */
export function resetColumnLayoutState(): void {
  buildSlotReserved = false;
  levelTimerShown = false;
  hudPanelRect = null;
  lootBoxBannerRect = null;
}

interface ColumnLayout {
  readonly build: Rect;
  readonly chip: Rect;
  readonly journal: Rect;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** How many extra columns the right-hand column may spill into on a very short window. */
const MAX_OVERFLOW_COLUMNS = 4;

/**
 * The right-hand column under Pause and Bag, laid out once for everything
 * that hangs in it: the Build button (where it is reserved), the achievement
 * chip's slot and the Journal.
 *
 * Each takes the next slot down the column while that slot is clear of the
 * rest of the HUD — the hotbar strip, Pause, the Bag row, the minimap, the
 * Follower button, the level timer, the loot-box banner and the HUD panel —
 * and of the bottom of the screen. Once one piece has had to leave the column,
 * the pieces after it leave too. A piece that leaves goes to the first slot
 * that is clear, searching up to {@link MAX_OVERFLOW_COLUMNS} columns to the
 * left, each from the Bag's row down and then upward:
 *
 * 1. first a slot clear of everything, the HUD panel included;
 * 2. failing that, a slot clear of everything but the HUD panel;
 * 3. failing both, beside the Bag, whatever it overlaps — only on a screen too
 *    small for any of the above.
 */
function columnLayout(miniMap: MiniMapSystem): ColumnLayout {
  const pause = pauseButtonRect(miniMap);
  const width = rightColBtnW();
  const slotStep = PAUSE_BTN_H + MOBILE_BUTTON_GAP;
  const screenFloor = viewportHeight() - RIGHT_COL_MARGIN;
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const occupied: Rect[] = [
    hotbarStripRect(),
    pause,
    { x: viewportWidth() - RIGHT_COL_MARGIN - mmSize, y: MINIMAP_Y, w: mmSize, h: mmSize },
  ];
  if (platform.isMobile) {
    // On a phone the Follower button stands above Pause in the column itself.
    occupied.push({
      x: pause.x,
      y: MINIMAP_Y + mmSize + BELOW_MAP_GAP + TIMER_H + MOBILE_BUTTON_GAP,
      w: MOBILE_BTN_W,
      h: MOBILE_BTN_H,
    });
  } else {
    occupied.push(followerButtonRect());
  }
  if (levelTimerShown) occupied.push(levelTimerRect(miniMap));
  if (lootBoxBannerRect !== null) occupied.push(lootBoxBannerRect);
  const bagRow = pause.y + BAG_SLOTS_BELOW_PAUSE * slotStep;
  occupied.push({ x: pause.x, y: bagRow, w: width, h: PAUSE_BTN_H });
  const panel = hudPanelRect;
  const isClear = (rect: Rect, avoidHudPanel: boolean): boolean =>
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.y + rect.h <= screenFloor &&
    occupied.every((other) => !rectsOverlap(rect, other)) &&
    !(avoidHudPanel && panel !== null && rectsOverlap(rect, panel));

  let nextColumnSlot = BAG_SLOTS_BELOW_PAUSE + 1;
  let columnOpen = true;
  let columnBottom = bagRow + PAUSE_BTN_H;
  const take = (rect: Rect): Rect => {
    occupied.push(rect);
    return rect;
  };
  // Rows nearest the Bag first: down from its row, then up toward the top.
  const overflowRows: number[] = [];
  for (let y = bagRow; y <= screenFloor; y += slotStep) overflowRows.push(y);
  for (let y = bagRow - slotStep; y >= MINIMAP_Y; y -= slotStep) overflowRows.push(y);
  const overflow = (w: number, h: number): Rect => {
    // Clear of the HUD panel if the screen allows it; on the very smallest a
    // corner of the panel is the only room left that is not another button.
    for (const avoidHudPanel of [true, false]) {
      for (let column = 1; column <= MAX_OVERFLOW_COLUMNS; column++) {
        const right = pause.x - (column - 1) * (width + MOBILE_BUTTON_GAP) - MOBILE_BUTTON_GAP;
        for (const y of overflowRows) {
          const rect = { x: right - w, y, w, h };
          if (isClear(rect, avoidHudPanel)) return take(rect);
        }
      }
    }
    // Nowhere clear on a screen this small: beside the Bag, as the least bad place.
    return take({ x: pause.x - MOBILE_BUTTON_GAP - w, y: bagRow, w, h });
  };
  const place = (h: number, w: number = width, gapAbove = 0): Rect => {
    if (columnOpen) {
      const y = gapAbove > 0 ? columnBottom + gapAbove : pause.y + nextColumnSlot * slotStep;
      const rect = { x: pause.x + width - w, y, w, h };
      if (isClear(rect, true)) {
        nextColumnSlot++;
        columnBottom = y + h;
        return take(rect);
      }
      // Once one piece has had to step out of the column, everything below it
      // does too: nothing hangs in the column past a gap.
      columnOpen = false;
    }
    return overflow(w, h);
  };
  const build = buildSlotReserved
    ? place(PAUSE_BTN_H)
    : { x: pause.x, y: pause.y + BUILD_SLOTS_BELOW_PAUSE * slotStep, w: width, h: PAUSE_BTN_H };
  const chip = place(CHIP_HEIGHT);
  const journal = place(JOURNAL_BTN_SIZE, JOURNAL_BTN_SIZE, JOURNAL_BTN_GAP);
  return { build, chip, journal };
}

/** The Journal button is a square, big enough that the rose reads at a glance. */
const JOURNAL_BTN_SIZE = 36;
const JOURNAL_BTN_GAP = 8;
/** Inset of the compass rose inside its button frame. */
const JOURNAL_ICON_INSET = 4;
/** The badge sits in the button's bottom-right corner, over the rose's rim. */
const JOURNAL_BADGE_X_INSET = 9;
const JOURNAL_BADGE_Y_INSET = 13;
const JOURNAL_BADGE_SIZE = 11;

/**
 * Where the Journal's compass button stands: at the top of the band of the
 * right-hand HUD column that is free under the minimap.
 *
 * The column is stacked differently on the two platforms and the arithmetic for
 * both already lives in this module, so it is answered here rather than
 * re-derived by the caller. Every slot above it is reserved *unconditionally*,
 * including the achievement chip's, which only appears when there is something
 * unread: a button placed against what happens to be on screen would jump down
 * the moment an achievement was earned, and the chip is hit-tested first — so it
 * would also quietly swallow the clicks aimed at the compass.
 *
 * - Desktop: the pause button, the Bag slot, the Build slot where it is
 *   reserved, then the achievement chip's slot; the Follower button stands
 *   below the column.
 * - Mobile: the Follower and Pause buttons are both up in the column and the Bag
 *   (and Build) buttons sit under them.
 *
 * On a window too short to hold the whole column — a phone in landscape, an
 * expanded minimap on a small desktop — it goes to a clear slot beside the
 * column instead, following `columnLayout`'s fallback order; only on a screen
 * with no clear slot at all can it land on other chrome.
 */
export function journalButtonRect(miniMap: MiniMapSystem): Rect {
  return columnLayout(miniMap).journal;
}

/**
 * The Journal button, with a badge count when quests are outstanding.
 *
 * `outstanding` only changes the frame's colour, never its size: a button that
 * grew when a quest was accepted would move the thing under the player's finger
 * at the moment they were most likely to be reaching for it.
 */
export function drawJournalButton(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  outstanding: number,
): Rect {
  const r = journalButtonRect(miniMap);
  drawButton(ctx, {
    x: r.x,
    y: r.y,
    width: r.w,
    height: r.h,
    label: '',
    sound: 'menu_open',
    ...(outstanding > 0 ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
  });
  drawCompassIcon(
    ctx,
    r.x + JOURNAL_ICON_INSET,
    r.y + JOURNAL_ICON_INSET,
    r.w - JOURNAL_ICON_INSET * 2,
  );
  if (outstanding > 0) {
    drawText(ctx, String(outstanding), {
      x: r.x + r.w - JOURNAL_BADGE_X_INSET,
      y: r.y + r.h - JOURNAL_BADGE_Y_INSET,
      size: JOURNAL_BADGE_SIZE,
      bold: true,
      color: '#fde68a',
      outline: true,
      align: 'center',
    });
  }
  return r;
}

/**
 * Where the Follower button stands when nothing overrides it: bottom-right,
 * clear of the hotbar.
 *
 * Exported because the right-hand HUD column has to keep clear of it —
 * anything hung under the minimap stops above it or steps aside — and
 * re-deriving that arithmetic anywhere else is how two pieces of chrome end up
 * on the same pixels.
 */
export function followerButtonRect(): Rect {
  return {
    x: viewportWidth() - MOBILE_BTN_MARGIN - MOBILE_BTN_W,
    y: viewportHeight() - SLOT_HEIGHT - BOTTOM_MARGIN - MOBILE_BTN_H - MOBILE_BTN_BOTTOM_OFFSET,
    w: MOBILE_BTN_W,
    h: MOBILE_BTN_H,
  };
}

/** Render the Follower button and write its rect to touch (works on both mobile and desktop). */
export function renderFollowerButton(
  ctx: CanvasRenderingContext2D,
  touch: MobileTouchState,
  companion: CompanionSystem,
  humanIsActive: boolean,
  overrideRect?: Rect,
): void {
  const r: Rect = overrideRect ?? followerButtonRect();
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

/** Clear space kept between a top strip and the HUD pieces either side of it. */
const TOP_STRIP_SIDE_GAP = 12;
/** Top edge of a strip sharing the minimap's row. */
const TOP_STRIP_Y = MINIMAP_Y;
/** Below this scale a strip squeezed between the HUD and the minimap is unreadable, so it drops under the HUD instead. */
const TOP_STRIP_MIN_SCALE = 0.75;
/** Clear space between the top-left HUD's bottom edge and a strip dropped under it. */
const UNDER_HUD_GAP = 8;

/** Where a strip of HUD chrome goes, and the scale it is drawn at to fit there. */
export interface StripSlot {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * The slot for a `width` × `height` strip centred at the top of the screen,
 * between the top-left HUD panel (`hudRect`, however it is laid out — full,
 * collapsed or mobile) and the minimap. Narrower than that gap it is scaled
 * down to fit; too narrow to scale readably — a phone in portrait — it moves
 * under the HUD panel on the left instead, which is the one place in the top
 * band nothing else claims.
 */
export function topCentreStripSlot(
  miniMap: MiniMapSystem,
  hudRect: Rect,
  width: number,
): StripSlot {
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const leftBound = hudRect.x + hudRect.w + TOP_STRIP_SIDE_GAP;
  const rightBound = viewportWidth() - RIGHT_COL_MARGIN - mmSize - TOP_STRIP_SIDE_GAP;
  const available = rightBound - leftBound;
  const squeeze = Math.min(1, available / width);
  if (squeeze >= TOP_STRIP_MIN_SCALE) {
    const drawnWidth = width * squeeze;
    const centred = viewportWidth() / 2 - drawnWidth / 2;
    const x = Math.min(Math.max(centred, leftBound), rightBound - drawnWidth);
    return { x, y: TOP_STRIP_Y, scale: squeeze };
  }
  const underHudWidth =
    viewportWidth() - RIGHT_COL_MARGIN - mmSize - TOP_STRIP_SIDE_GAP - hudRect.x;
  const underHudScale = Math.min(1, Math.max(TOP_STRIP_MIN_SCALE, underHudWidth / width));
  return { x: hudRect.x, y: hudRect.y + hudRect.h + UNDER_HUD_GAP, scale: underHudScale };
}
