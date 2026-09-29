/**
 * DungeonUIRenderer — stateless rendering functions for the dungeon HUD. Each
 * function is a pure draw call with no side effects on game state.
 */

import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import { STAT_BOOST_FLASH_FRAMES, type Player, type StatName } from '../Player';
import { drawEmbermote, drawGlow, rgba } from '../sprites/status/statusPaint';
import { STAT_BOOST_COLOR, STAT_BOOST_MOTE_HEAT } from '../sprites/statBoostColors';
import type { Mob } from '../creatures/Mob';
import type { Villager } from './briarHollow/Villager';
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
import { drawText, wrapText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { drawSatchelIcon } from '../ui/icons/satchelIcon';
import { drawCompassIcon } from '../ui/icons/compassIcon';
import { drawConstructionIcon } from '../ui/icons/constructionIcon';
import { keybindings } from '../core/Keybindings';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { bottomRowButtonRects, stackedAboveRect } from './MobileHUDSystem';
import { bestSpot, insetRect, packStack, type PackOptions, type PackSize } from '../ui/hudPacking';

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
const FRAMES_PER_SECOND = 60;
const TEN_MINUTES = 10;
const FIVE_MINUTES = 5;
const ONE_MINUTE = 1;
/** ≤10 min: the box and its text grow, and the border turns red. */
const TEN_MINUTE_WARNING_SECONDS = TEN_MINUTES * SECONDS_PER_MINUTE;
/** ≤5 min: bigger again, and the digits themselves turn red. */
const FIVE_MINUTE_WARNING_SECONDS = FIVE_MINUTES * SECONDS_PER_MINUTE;
/** ≤1 min: the box is dropped for a full-screen pulsing countdown. */
const ONE_MINUTE_CRITICAL_SECONDS = ONE_MINUTE * SECONDS_PER_MINUTE;
/** The 5-minute tier's scale — also what {@link levelTimerRect} reserves on desktop, since it is the largest box ever drawn. */
const TIMER_DOUBLE_SCALE = 2;
const TIMER_WARNING_SCALE = 1.5;
const URGENT_OPACITY = 0.85;
const URGENT_WAVE_PERIOD = 160;
const URGENT_WAVE_AMP = 0.12;
const WARNING_OPACITY = 0.85;
const NORMAL_OPACITY = 0.65;
const NON_URGENT_ALPHA = 0.75;
const TIMER_BORDER_WIDTH = 1.5;
const TIMER_LABEL_TOP_PAD = 5;
const TIMER_DISPLAY_TOP_OFFSET = 17;
const TIMER_LABEL_SIZE = 9;
const TIMER_DISPLAY_SIZE = 17;
const CRITICAL_COUNTDOWN_TOP_Y = 46;
const CRITICAL_COUNTDOWN_BASE_SIZE = 40;
/** How far the countdown's size swings around its base size, once per second. */
const CRITICAL_COUNTDOWN_PULSE_AMPLITUDE = 0.18;
const CRITICAL_COUNTDOWN_GLOW_BLUR = 18;
/**
 * A held clock reads cool and still: the label says why, and blue takes over
 * from the warning reds so a paused final minute does not look like a live one.
 */
const TIMER_PAUSED_LABEL = 'TIMER PAUSED';
const TIMER_PAUSED_ACCENT = '#7dd3fc';
const TIMER_PAUSED_FILL = `rgba(8,30,48,${NORMAL_OPACITY})`;

// Level up flash
const LEVEL_UP_FLASH_DURATION = 120;
const LEVEL_UP_RISE_DISTANCE = 28;
const LEVEL_UP_Y_OFFSET = 12;
const LEVEL_UP_TEXT_SIZE = 13;
const LEVEL_UP_TEXT_Y_RISE = 10;

// Stat-boost potion fanfare
const STAT_BOOST_Y_OFFSET = 46;
const STAT_BOOST_TEXT_SIZE = 30;
/** First half of the punch ramps up past 1x, second half settles back to it. */
const STAT_BOOST_PUNCH_FRAMES = 16;
const STAT_BOOST_PUNCH_START_SCALE = 0.4;
const STAT_BOOST_PUNCH_OVERSHOOT_SCALE = 1.3;
const STAT_BOOST_FADE_START_FRACTION = 0.55;
const STAT_BOOST_BURST_FRAMES = 20;
const STAT_BOOST_BURST_MAX_RADIUS = 64;
const STAT_BOOST_BURST_ALPHA = 0.5;
const STAT_BOOST_MOTE_COUNT = 8;
const STAT_BOOST_MOTE_RISE_PX = 44;
const STAT_BOOST_MOTE_RADIUS = 4;
const STAT_BOOST_MOTE_SPREAD_PX = 24;
/** Spaces each mote's lateral lane apart around the circle of `sin`, so the motes don't line up in a single column. */
const STAT_BOOST_MOTE_LANE_SPACING = 2.4;
const STAT_BOOST_MOTE_ALPHA = 0.85;

/** Full stat names, for the potion fanfare's "+1 STRENGTH" wording. */
const STAT_FULL_NAME: Record<StatName, string> = {
  strength: 'STRENGTH',
  intelligence: 'INTELLIGENCE',
  constitution: 'CONSTITUTION',
  dexterity: 'DEXTERITY',
};

/**
 * Scale of the reward text through its entrance: grows past full size, then
 * eases back down to it, which is what makes the pop read as a punch rather
 * than a plain fade-in.
 */
function statBoostPunchScale(elapsedFrames: number): number {
  if (elapsedFrames >= STAT_BOOST_PUNCH_FRAMES) return 1;
  const half = STAT_BOOST_PUNCH_FRAMES / 2;
  if (elapsedFrames < half) {
    const t = elapsedFrames / half;
    return (
      STAT_BOOST_PUNCH_START_SCALE +
      (STAT_BOOST_PUNCH_OVERSHOOT_SCALE - STAT_BOOST_PUNCH_START_SCALE) * t
    );
  }
  const t = (elapsedFrames - half) / half;
  return STAT_BOOST_PUNCH_OVERSHOOT_SCALE + (1 - STAT_BOOST_PUNCH_OVERSHOOT_SCALE) * t;
}

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
const TOOLTIP_SUBTITLE_SIZE = 10;
const TOOLTIP_SUBTITLE_Y_ADJUST = 8;
const TOOLTIP_SUBTITLE_COLOR = '#9ca3af';
const TOOLTIP_DESC_Y_ADJUST = 9;
/** Descriptions wrap past this width, so a villager's backstory stays a readable card. */
const TOOLTIP_MAX_DESC_WIDTH = 260;
const TOOLTIP_DESC_LINE_HEIGHT = 14;
/** How far a cursor can sit from a villager's tile origin and still count as hovering it — matches the mob hit-test radius. */
const TOOLTIP_HOVER_RADIUS = TILE_SIZE * Math.SQRT2;

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
const MOBILE_BAG_ICON_SIZE = 14;
const MOBILE_BAG_ICON_PAD = 4;
const MOBILE_BAG_BADGE_RADIUS = 4;
const MOBILE_BAG_BOUNCE_SCALE_AMOUNT = 0.18;
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

/**
 * Where a phone's Follower button stands, as the phone's right-hand cluster
 * places it (see {@link phoneClusterLayout}). Exported so every layout that
 * keeps clear of it, and its gate, measure the button that is drawn.
 */
export function mobileFollowerButtonRect(miniMap: MiniMapSystem): Rect {
  return phoneClusterLayout(miniMap).follower;
}

/** Compute the pause button rectangle based on minimap size. */
export function pauseButtonRect(miniMap: MiniMapSystem): Rect {
  if (platform.isMobile) return phoneClusterLayout(miniMap).pause;
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const w = rightColBtnW();
  return {
    x: viewportWidth() - RIGHT_COL_MARGIN - w,
    y: MINIMAP_Y + mmSize + BELOW_MAP_GAP,
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

/**
 * Where the level's collapse timer stands, on floors that have one.
 *
 * On desktop, always the footprint of the largest box the timer ever draws
 * (the 5-minute tier's {@link TIMER_DOUBLE_SCALE}), anchored to the same
 * corner the timer grows from, so every consumer that keeps other HUD
 * elements clear of it — the column layout, the siege HUD — reserves enough
 * room no matter which tier is actually on screen this frame. A phone's timer
 * never grows (see {@link timerTierScale}), so its footprint is the box it
 * draws, wherever the phone's cluster found room for it.
 */
export function levelTimerRect(miniMap: MiniMapSystem): Rect {
  if (platform.isMobile) return phoneClusterLayout(miniMap).timer;
  const w = TIMER_W * TIMER_DOUBLE_SCALE;
  const h = TIMER_H * TIMER_DOUBLE_SCALE;
  const pauseBtn = pauseButtonRect(miniMap);
  return { x: pauseBtn.x - TIMER_PAUSE_GAP - w, y: pauseBtn.y, w, h };
}

/**
 * How large the timer box is drawn for the time left. A phone keeps it at its
 * base size and lets the colour and the pulse carry the urgency: in landscape
 * a box grown to double size would take the room of three buttons, which a
 * phone's short screen does not have to spare.
 */
function timerTierScale(fiveMinuteTier: boolean, tenMinuteTier: boolean): number {
  if (platform.isMobile) return 1;
  if (fiveMinuteTier) return TIMER_DOUBLE_SCALE;
  return tenMinuteTier ? TIMER_WARNING_SCALE : 1;
}

/**
 * The full-screen countdown that replaces the box in the final minute —
 * centred at the top so nothing in the right-hand column (minimap, pause,
 * the timer's own vacated corner) has to make room for it.
 */
function renderCriticalCountdown(
  ctx: CanvasRenderingContext2D,
  display: string,
  timerFrames: number,
  paused: boolean,
): void {
  const secondPhase = (timerFrames % FRAMES_PER_SECOND) / FRAMES_PER_SECOND;
  const pulse = paused
    ? 1
    : 1 + CRITICAL_COUNTDOWN_PULSE_AMPLITUDE * Math.sin(secondPhase * Math.PI);
  const color = paused ? TIMER_PAUSED_ACCENT : '#ef4444';
  const countdownSize = Math.round(CRITICAL_COUNTDOWN_BASE_SIZE * pulse);
  drawText(ctx, display, {
    x: viewportWidth() / 2,
    y: CRITICAL_COUNTDOWN_TOP_Y,
    size: countdownSize,
    bold: true,
    color,
    align: 'center',
    glow: color,
    glowBlur: CRITICAL_COUNTDOWN_GLOW_BLUR,
  });
  if (paused) {
    drawText(ctx, TIMER_PAUSED_LABEL, {
      x: viewportWidth() / 2,
      y: CRITICAL_COUNTDOWN_TOP_Y + countdownSize,
      size: TIMER_LABEL_SIZE,
      color: TIMER_PAUSED_ACCENT,
      align: 'center',
    });
  }
}

export type LevelTimerCue = 'ten_minute_warning' | 'five_minute_warning' | 'final_minute_heartbeat';

const secondsShown = (timerFrames: number): number =>
  Math.max(0, Math.ceil(timerFrames / FRAMES_PER_SECOND));

/**
 * The audible cue owed for one frame of countdown, judged on the whole seconds
 * the readout shows so the sound lands on the same beat as the display. Null
 * when nothing was crossed; a timer rewound by a checkpoint restore never
 * passes through here, so it cannot re-announce a tier.
 */
export function levelTimerCue(framesBefore: number, framesAfter: number): LevelTimerCue | null {
  const before = secondsShown(framesBefore);
  const after = secondsShown(framesAfter);
  if (before === after) return null;
  if (after <= ONE_MINUTE_CRITICAL_SECONDS) return 'final_minute_heartbeat';
  if (before > FIVE_MINUTE_WARNING_SECONDS && after <= FIVE_MINUTE_WARNING_SECONDS) {
    return 'five_minute_warning';
  }
  if (before > TEN_MINUTE_WARNING_SECONDS && after <= TEN_MINUTE_WARNING_SECONDS) {
    return 'ten_minute_warning';
  }
  return null;
}

export function renderLevelTimer(
  ctx: CanvasRenderingContext2D,
  miniMap: MiniMapSystem,
  timerFrames: number,
  paused = false,
): void {
  const totalSec = secondsShown(timerFrames);
  const min = Math.floor(totalSec / SECONDS_PER_MINUTE);
  const sec = totalSec % SECONDS_PER_MINUTE;
  const display = `${min}:${sec.toString().padStart(2, '0')}`;

  if (totalSec <= ONE_MINUTE_CRITICAL_SECONDS) {
    renderCriticalCountdown(ctx, display, timerFrames, paused);
    return;
  }

  const fiveMinuteTier = totalSec <= FIVE_MINUTE_WARNING_SECONDS;
  const tenMinuteTier = totalSec <= TEN_MINUTE_WARNING_SECONDS;
  const scale = timerTierScale(fiveMinuteTier, tenMinuteTier);

  // Anchored to the reserved footprint's fixed corner — the timer grows away
  // from the pause button and the minimap, never toward them.
  const reserved = levelTimerRect(miniMap);
  const w = TIMER_W * scale;
  const h = TIMER_H * scale;
  const x = reserved.x + (reserved.w - w);
  const y = reserved.y;

  const urgentAlpha = fiveMinuteTier
    ? URGENT_OPACITY + Math.sin(Date.now() / URGENT_WAVE_PERIOD) * URGENT_WAVE_AMP
    : NON_URGENT_ALPHA;
  const runningFill = tenMinuteTier
    ? `rgba(100,0,0,${fiveMinuteTier ? urgentAlpha : WARNING_OPACITY})`
    : `rgba(0,0,0,${NORMAL_OPACITY})`;
  const runningBorder = tenMinuteTier ? '#ef4444' : '#475569';
  const runningDigits = fiveMinuteTier ? '#f87171' : '#e2e8f0';

  drawBox(ctx, {
    x,
    y,
    width: w,
    height: h,
    fill: paused ? TIMER_PAUSED_FILL : runningFill,
    border: paused ? TIMER_PAUSED_ACCENT : runningBorder,
    borderWidth: TIMER_BORDER_WIDTH,
  });

  const labelTopPad = TIMER_LABEL_TOP_PAD * scale;
  const displayTopOffset = TIMER_DISPLAY_TOP_OFFSET * scale;
  drawText(ctx, paused ? TIMER_PAUSED_LABEL : 'TIME REMAINING', {
    x: x + w / 2,
    y: y + labelTopPad,
    size: TIMER_LABEL_SIZE * scale,
    color: paused ? TIMER_PAUSED_ACCENT : '#94a3b8',
    align: 'center',
  });
  drawText(ctx, display, {
    x: x + w / 2,
    y: y + displayTopOffset,
    size: TIMER_DISPLAY_SIZE * scale,
    bold: true,
    color: paused ? TIMER_PAUSED_ACCENT : runningDigits,
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

/**
 * The stat-boost potion's own fanfare: a large centred "+N STATNAME" with a
 * scale-punch entrance, a stat-coloured radial burst and rising motes. Kept
 * entirely separate from {@link renderLevelUpFlash} so a potion never reads as
 * a level-up.
 */
export function renderStatBoostFlash(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  pm: PlayerManager,
): void {
  for (const p of pm.players()) {
    if (p.statBoostFlashFrame <= 0 || p.statBoostFlashStat === null) continue;
    const stat = p.statBoostFlashStat;
    const elapsed = STAT_BOOST_FLASH_FRAMES - p.statBoostFlashFrame;
    const progress = elapsed / STAT_BOOST_FLASH_FRAMES;
    const alpha =
      progress < STAT_BOOST_FADE_START_FRACTION
        ? 1
        : Math.max(
            0,
            1 - (progress - STAT_BOOST_FADE_START_FRACTION) / (1 - STAT_BOOST_FADE_START_FRACTION),
          );
    if (alpha <= 0) continue;

    const color = STAT_BOOST_COLOR[stat];
    const cx = p.x - camX + TILE_SIZE / 2;
    const cy = p.y - camY - STAT_BOOST_Y_OFFSET;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (elapsed < STAT_BOOST_BURST_FRAMES) {
      const burstT = elapsed / STAT_BOOST_BURST_FRAMES;
      drawGlow(
        ctx,
        color,
        cx,
        cy,
        STAT_BOOST_BURST_MAX_RADIUS * burstT,
        STAT_BOOST_BURST_ALPHA * (1 - burstT) * alpha,
      );
    }

    for (let i = 0; i < STAT_BOOST_MOTE_COUNT; i++) {
      const stagger = i / STAT_BOOST_MOTE_COUNT;
      const phase = (progress + stagger) % 1;
      const moteAlpha = Math.sin(phase * Math.PI) * STAT_BOOST_MOTE_ALPHA * alpha;
      if (moteAlpha <= 0) continue;
      const lane = Math.sin(i * STAT_BOOST_MOTE_LANE_SPACING) * STAT_BOOST_MOTE_SPREAD_PX;
      drawEmbermote(
        ctx,
        color,
        STAT_BOOST_MOTE_HEAT,
        cx + lane,
        cy - phase * STAT_BOOST_MOTE_RISE_PX,
        STAT_BOOST_MOTE_RADIUS,
        moteAlpha,
      );
    }
    ctx.restore();

    const scale = statBoostPunchScale(elapsed);
    drawText(ctx, `+${p.statBoostFlashAmount} ${STAT_FULL_NAME[stat]}`, {
      x: cx,
      y: cy,
      size: STAT_BOOST_TEXT_SIZE * scale,
      bold: true,
      color: rgba(color, 1),
      glow: rgba(color, 1),
      outline: true,
      alpha,
      align: 'center',
    });
  }
}

/** Content shown in the hover tooltip, common to a mob and a Briar Hollow villager. */
interface EntityTooltipContent {
  name: string;
  subtitle?: string;
  description: string;
  /** Red border/name when true (a hostile mob), green otherwise (an ally or villager). */
  hostile: boolean;
}

function drawEntityTooltipBox(
  ctx: CanvasRenderingContext2D,
  mouseX: number,
  mouseY: number,
  content: EntityTooltipContent,
): void {
  const { name, subtitle, description, hostile } = content;

  ctx.font = 'bold 13px sans-serif';
  const nameW = ctx.measureText(name).width;
  ctx.font = `${TOOLTIP_DESC_SIZE}px sans-serif`;
  const screenLimitedDescWidth = viewportWidth() - TOOLTIP_MARGIN_X * 2 - TOOLTIP_PAD * 2;
  const descWrapWidth = Math.min(TOOLTIP_MAX_DESC_WIDTH, screenLimitedDescWidth);
  const descLines = description ? wrapText(ctx, description, descWrapWidth) : [];
  const descW = Math.max(0, ...descLines.map((line) => ctx.measureText(line).width));
  let subtitleW = 0;
  if (subtitle !== undefined) {
    ctx.font = `${TOOLTIP_SUBTITLE_SIZE}px sans-serif`;
    subtitleW = ctx.measureText(subtitle).width;
  }
  const boxW = Math.max(nameW, descW, subtitleW) + TOOLTIP_PAD * 2;
  const subtitleBlockHeight = subtitle === undefined ? 0 : TOOLTIP_SUBTITLE_SIZE + TOOLTIP_LINE_GAP;
  const boxH =
    TOOLTIP_NAME_SIZE +
    TOOLTIP_LINE_GAP +
    subtitleBlockHeight +
    TOOLTIP_DESC_SIZE +
    Math.max(0, descLines.length - 1) * TOOLTIP_DESC_LINE_HEIGHT +
    TOOLTIP_PAD * 2;

  let tx = mouseX + TOOLTIP_OFFSET_X;
  let ty = mouseY - boxH - TOOLTIP_OFFSET_Y;
  if (tx + boxW > viewportWidth() - TOOLTIP_MARGIN_X)
    tx = viewportWidth() - boxW - TOOLTIP_MARGIN_X;
  if (tx < TOOLTIP_MARGIN_X) tx = TOOLTIP_MARGIN_X;
  if (ty < TOOLTIP_MARGIN_X) ty = mouseY + TOOLTIP_MARGIN_Y;

  drawBox(ctx, {
    x: tx,
    y: ty,
    width: boxW,
    height: boxH,
    fill: '#1a1a2e',
    border: hostile ? '#ef4444' : '#4ade80',
    borderWidth: TOOLTIP_BORDER_WIDTH,
    radius: TOOLTIP_CORNER_RADIUS,
    alpha: TOOLTIP_ALPHA,
  });

  drawText(ctx, name, {
    x: tx + TOOLTIP_PAD,
    y: ty + TOOLTIP_PAD + TOOLTIP_NAME_SIZE - TOOLTIP_NAME_Y_ADJUST,
    size: TOOLTIP_NAME_SIZE,
    bold: true,
    font: 'sans-serif',
    color: hostile ? '#fca5a5' : '#86efac',
  });

  let nextTop = ty + TOOLTIP_PAD + TOOLTIP_NAME_SIZE + TOOLTIP_LINE_GAP;
  if (subtitle !== undefined) {
    drawText(ctx, subtitle, {
      x: tx + TOOLTIP_PAD,
      y: nextTop + TOOLTIP_SUBTITLE_SIZE - TOOLTIP_SUBTITLE_Y_ADJUST,
      size: TOOLTIP_SUBTITLE_SIZE,
      italic: true,
      font: 'sans-serif',
      color: TOOLTIP_SUBTITLE_COLOR,
    });
    nextTop += TOOLTIP_SUBTITLE_SIZE + TOOLTIP_LINE_GAP;
  }

  descLines.forEach((line, index) => {
    drawText(ctx, line, {
      x: tx + TOOLTIP_PAD,
      y: nextTop + TOOLTIP_DESC_SIZE - TOOLTIP_DESC_Y_ADJUST + index * TOOLTIP_DESC_LINE_HEIGHT,
      size: TOOLTIP_DESC_SIZE,
      font: 'sans-serif',
      color: '#d1d5db',
    });
  });
}

/** A villager's tooltip name and body, or null when nothing should show for them. */
function villagerTooltipContent(villager: Villager): EntityTooltipContent {
  return {
    name: villager.displayName ?? 'Ratkin Villager',
    subtitle: 'Ratkin',
    description: villager.description,
    hostile: false,
  };
}

export function renderEntityTooltip(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  mouseX: number,
  mouseY: number,
  mobGrid: SpatialGrid<Mob>,
  villagers: readonly Villager[] = [],
): void {
  const wx = mouseX + camX;
  const wy = mouseY + camY;

  // An entity can only be hovered when the cursor is inside its tile square,
  // so every candidate has its origin within that square's diagonal of the
  // cursor.
  let hoveredMob: Mob | null = null;
  for (const mob of mobGrid.queryCircle(wx, wy, TOOLTIP_HOVER_RADIUS)) {
    if (!mob.isAlive) continue;
    if (wx >= mob.x && wx <= mob.x + TILE_SIZE && wy >= mob.y && wy <= mob.y + TILE_SIZE) {
      hoveredMob = mob;
      break;
    }
  }

  if (hoveredMob !== null) {
    drawEntityTooltipBox(ctx, mouseX, mouseY, {
      name: hoveredMob.displayName,
      description: hoveredMob.description,
      hostile: hoveredMob.isHostile,
    });
    return;
  }

  const hoveredVillager = villagers.find(
    (villager) =>
      wx >= villager.x &&
      wx <= villager.x + TILE_SIZE &&
      wy >= villager.y &&
      wy <= villager.y + TILE_SIZE,
  );
  if (hoveredVillager !== undefined) {
    drawEntityTooltipBox(ctx, mouseX, mouseY, villagerTooltipContent(hoveredVillager));
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
  /** Whether the viewed crawler's bag holds an unseen item upgrade — draws a badge on the Bag button. */
  hasUnseenUpgrade?: boolean;
  /** 0 (settled) to 1 (an item just landed) — squash-bounces the Bag button. */
  bagBouncePulse?: number;
}

/** A phone's Switch button, bottom left above the hotbar. */
export function mobileSwitchButtonRect(): Rect {
  return bottomRowButtonRects(viewportWidth(), viewportHeight(), SLOT_HEIGHT, 0).switchButton;
}

/** A phone's Summon button, stacked on Switch, wherever Mongo can be summoned. */
export function mobileSummonButtonRect(): Rect {
  return stackedAboveRect(mobileSwitchButtonRect());
}

/** A phone's Bag button: under Pause, or wherever the phone's cluster found room for both. */
export function mobileBagButtonRect(miniMap: MiniMapSystem): Rect {
  return phoneClusterLayout(miniMap).bag;
}

export function renderMobileButtons(
  ctx: CanvasRenderingContext2D,
  touch: MobileTouchState,
  state: MobileButtonState,
): void {
  touch.switchBtnRect = mobileSwitchButtonRect();
  const followerRect = mobileFollowerButtonRect(state.miniMap);
  touch.gearBtnRect = {
    x: MOBILE_INVALID_X,
    y: MOBILE_GEAR_BTN_RECT_Y,
    w: MOBILE_GEAR_BTN_RECT_W,
    h: MOBILE_GEAR_BTN_RECT_H,
  };
  touch.bagBtnRect = mobileBagButtonRect(state.miniMap);

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
  const bagBounceScale =
    1 + Math.sin((state.bagBouncePulse ?? 0) * Math.PI) * MOBILE_BAG_BOUNCE_SCALE_AMOUNT;
  const bagCx = touch.bagBtnRect.x + touch.bagBtnRect.w / 2;
  const bagCy = touch.bagBtnRect.y + touch.bagBtnRect.h / 2;
  ctx.save();
  ctx.translate(bagCx, bagCy);
  ctx.scale(bagBounceScale, bagBounceScale);
  ctx.translate(-bagCx, -bagCy);
  drawSmallBtn(touch.bagBtnRect, 'Bag', state.inventoryPanel.isOpen);
  drawSatchelIcon(
    ctx,
    touch.bagBtnRect.x + MOBILE_BAG_ICON_PAD,
    touch.bagBtnRect.y + (touch.bagBtnRect.h - MOBILE_BAG_ICON_SIZE) / 2,
    MOBILE_BAG_ICON_SIZE,
  );
  if (state.hasUnseenUpgrade ?? false) {
    ctx.save();
    ctx.fillStyle = '#4ade80';
    ctx.strokeStyle = '#052e16';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      touch.bagBtnRect.x + touch.bagBtnRect.w - MOBILE_BAG_BADGE_RADIUS,
      touch.bagBtnRect.y + MOBILE_BAG_BADGE_RADIUS,
      MOBILE_BAG_BADGE_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (state.mongoSystem.canShow && state.cat.isActive) {
    const summon = mobileSummonButtonRect();
    touch.summonBtnRect = state.mongoSystem.renderSummonButton(
      ctx,
      summon.x,
      summon.y,
      summon.w,
      summon.h,
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

/** What on the HUD panel no button may ever cover: its collapse toggle and the HP bars. */
let hudPanelKeepouts: readonly Rect[] = [];

/** Called by the scene with `hudKeepouts` once the HUD panel has been drawn. */
export function setHudPanelKeepouts(rects: readonly Rect[]): void {
  hudPanelKeepouts = rects;
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
  hudPanelKeepouts = [];
  lootBoxBannerRect = null;
}

/**
 * The phone's right-hand cluster: the level timer, the Follower button, Pause
 * and Bag, then the Build button, the achievement chip and the Journal.
 */
interface PhoneClusterLayout extends ColumnLayout {
  readonly timer: Rect;
  readonly follower: Rect;
  readonly pause: Rect;
  readonly bag: Rect;
}

/** A slot that is not on screen, for a cluster piece this floor does not show. */
const OFFSCREEN_SLOT: Rect = { x: MOBILE_INVALID_X, y: 0, w: 0, h: 0 };
/**
 * The height the minimap's caption takes under it. With the cluster's gap
 * round it, the first piece under the minimap starts `BELOW_MAP_GAP` below.
 */
const MINIMAP_CAPTION_H = BELOW_MAP_GAP - MOBILE_BUTTON_GAP;
/**
 * What a pixel of sideways drift from the column under the minimap costs, in
 * pixels of drop down it. Large enough that a portrait phone keeps the whole
 * cluster in one column; a landscape one moves pieces beside the minimap or
 * across only once the column runs into the hotbar.
 */
const COLUMN_SHIFT_COST = 4;

/** The minimap and the caption drawn under it. */
function miniMapWithCaption(miniMap: MiniMapSystem): Rect {
  const map = miniMap.screenRect;
  return { x: map.x, y: map.y, w: map.w, h: map.h + MINIMAP_CAPTION_H };
}

let phoneClusterMemo: { readonly key: string; readonly layout: PhoneClusterLayout } | null = null;

/**
 * The phone's right-hand cluster, placed into whatever room the screen has.
 *
 * Under the minimap in one column, as long as the column fits; on a short
 * screen — a phone in landscape — a piece that no longer fits moves into the
 * next column to the left, or up beside the minimap, wherever
 * {@link COLUMN_SHIFT_COST} finds the nearest clear room. Pause and Bag go as
 * a pair where they can. Every piece keeps clear of the minimap and its
 * caption, the hotbar, the Switch and Summon buttons, the HUD panel's
 * collapse toggle and HP bars and, while there is room elsewhere, the rest of
 * the HUD panel.
 *
 * Only what stays put for a whole floor moves the cluster: the timer, the
 * Summon slot and the Follower button are held whether or not they show this
 * frame, so a button never jumps from under the player's finger. The loot-box
 * banner moves only the pieces after Pause and Bag, as it always has.
 */
function phoneClusterLayout(miniMap: MiniMapSystem): PhoneClusterLayout {
  const width = viewportWidth();
  const height = viewportHeight();
  const map = miniMap.screenRect;
  const key = JSON.stringify([
    width,
    height,
    map,
    hudPanelRect,
    hudPanelKeepouts,
    levelTimerShown,
    buildSlotReserved,
    lootBoxBannerRect,
  ]);
  if (phoneClusterMemo !== null && phoneClusterMemo.key === key) return phoneClusterMemo.layout;

  const anchorRight = width - RIGHT_COL_MARGIN;
  const anchorTop = map.y + map.h + BELOW_MAP_GAP;
  const blocked: Rect[] = [
    miniMapWithCaption(miniMap),
    insetRect(hotbarStripRect(), MOBILE_BUTTON_GAP),
    mobileSwitchButtonRect(),
    mobileSummonButtonRect(),
    ...hudPanelKeepouts,
  ];
  const options: PackOptions = {
    bounds: {
      x: RIGHT_COL_MARGIN,
      y: MINIMAP_Y,
      w: width - RIGHT_COL_MARGIN * 2,
      h: height - MINIMAP_Y - RIGHT_COL_MARGIN,
    },
    blocked,
    avoid: hudPanelRect === null ? [] : [hudPanelRect],
    gap: MOBILE_BUTTON_GAP,
    cost: (rect) => (anchorRight - (rect.x + rect.w)) * COLUMN_SHIFT_COST + rect.y,
    seedXs: [],
    seedYs: [anchorTop],
  };
  const placed: Rect[] = [];
  const place = (stack: readonly PackSize[]): Rect[] => {
    const rects = packStack(stack, placed, options);
    placed.push(...rects);
    return rects;
  };
  const one = (size: PackSize): Rect => place([size])[0] ?? OFFSCREEN_SLOT;

  const timer = levelTimerShown ? one({ w: TIMER_W, h: TIMER_H }) : OFFSCREEN_SLOT;
  const follower = one({ w: MOBILE_BTN_W, h: MOBILE_BTN_H });
  const smallButton: PackSize = { w: MOBILE_BTN_W, h: PAUSE_BTN_H };
  const [pause = OFFSCREEN_SLOT, bag = OFFSCREEN_SLOT] = place([smallButton, smallButton]);
  if (lootBoxBannerRect !== null) blocked.push(lootBoxBannerRect);
  const build = buildSlotReserved ? one(smallButton) : OFFSCREEN_SLOT;
  const chip = one({ w: MOBILE_BTN_W, h: CHIP_HEIGHT });
  const journal = one({ w: JOURNAL_BTN_SIZE, h: JOURNAL_BTN_SIZE });

  const layout: PhoneClusterLayout = { timer, follower, pause, bag, build, chip, journal };
  phoneClusterMemo = { key, layout };
  return layout;
}

interface ColumnLayout {
  readonly build: Rect;
  readonly chip: Rect;
  readonly journal: Rect;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The right-hand column under Pause and Bag, laid out once for everything
 * that hangs in it: the Build button (where it is reserved), the achievement
 * chip's slot and the Journal. A phone's comes from its cluster
 * ({@link phoneClusterLayout}); what follows is the desktop column.
 *
 * Each takes the next slot down the column while that slot is clear of the
 * rest of the HUD — the hotbar strip, Pause, the Bag row, the minimap, the
 * Follower button, the level timer, the loot-box banner and the HUD panel —
 * and of the bottom of the screen. Once one piece has had to leave the column,
 * the pieces after it leave too. A piece that leaves goes to the first slot
 * that is clear, searching column by column to the left as far as the
 * screen's edge, each from the Bag's row down and then upward:
 *
 * 1. first a slot clear of everything, the HUD panel included;
 * 2. failing that, a slot clear of everything but the HUD panel;
 * 3. failing both, beside the Bag, whatever it overlaps — only on a screen too
 *    small for any of the above.
 */
function columnLayout(miniMap: MiniMapSystem): ColumnLayout {
  if (platform.isMobile) return phoneClusterLayout(miniMap);
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
  occupied.push(followerButtonRect());
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
      const columnStep = width + MOBILE_BUTTON_GAP;
      for (let right = pause.x - MOBILE_BUTTON_GAP; right >= w; right -= columnStep) {
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
 * - Mobile: last in the phone's cluster, after the timer, the Follower button,
 *   Pause and Bag, Build and the chip, wherever that cluster finds it room.
 *
 * On a window too short to hold the whole column — an expanded minimap on a
 * small desktop — it goes to a clear slot beside the column instead, following
 * `columnLayout`'s fallback order; only on a screen with no clear slot at all
 * can it land on other chrome.
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
 * Every piece of a phone's HUD that other chrome must keep off, bar the
 * minimap: the cluster's buttons and timer, Switch and Summon, the hotbar, and
 * the HUD panel's collapse toggle and HP bars. Empty on desktop.
 */
export function phoneHudButtonRects(miniMap: MiniMapSystem): Rect[] {
  if (!platform.isMobile) return [];
  const cluster = phoneClusterLayout(miniMap);
  const clusterPieces = [
    cluster.timer,
    cluster.follower,
    cluster.pause,
    cluster.bag,
    cluster.build,
    cluster.chip,
    cluster.journal,
  ].filter((rect) => rect.w > 0);
  return [
    ...clusterPieces,
    mobileSwitchButtonRect(),
    mobileSummonButtonRect(),
    hotbarStripRect(),
    ...hudPanelKeepouts,
  ];
}

/** Steps a phone's strip down through while searching for room, largest first. */
const PHONE_STRIP_SCALE_STEP = 0.05;

/**
 * Where a phone's strip goes when its usual slot lands on a button: the clear
 * spot nearest the top of the screen's middle, at the largest readable scale,
 * off the HUD panel too where the screen has room for that — and over the
 * panel's text, never its toggle or HP bars, where it has not. Null when the
 * screen has no such spot.
 */
function phoneStripRefuge(
  miniMap: MiniMapSystem,
  hudRect: Rect,
  width: number,
  height: number,
): StripSlot | null {
  const screenW = viewportWidth();
  const buttons = [...phoneHudButtonRects(miniMap), miniMapWithCaption(miniMap)];
  const bounds: Rect = {
    x: RIGHT_COL_MARGIN,
    y: TOP_STRIP_Y,
    w: screenW - RIGHT_COL_MARGIN * 2,
    h: viewportHeight() - TOP_STRIP_Y - RIGHT_COL_MARGIN,
  };
  for (const obstacles of [[...buttons, hudRect], buttons]) {
    for (
      let scale = 1;
      scale >= TOP_STRIP_MIN_SCALE - Number.EPSILON;
      scale -= PHONE_STRIP_SCALE_STEP
    ) {
      const spot = bestSpot({ w: width * scale, h: height * scale }, obstacles, {
        bounds,
        blocked: [],
        avoid: [],
        gap: MOBILE_BUTTON_GAP,
        cost: (rect) => Math.hypot(rect.x + rect.w / 2 - screenW / 2, rect.y - TOP_STRIP_Y),
        seedXs: [screenW / 2 - (width * scale) / 2],
        seedYs: [],
      });
      if (spot !== null) return { x: spot.x, y: spot.y, scale };
    }
  }
  return null;
}

/**
 * The slot for a `width` × `height` strip centred at the top of the screen,
 * between the top-left HUD panel (`hudRect`, however it is laid out — full,
 * collapsed or mobile) and the minimap. Narrower than that gap it is scaled
 * down to fit; too narrow to scale readably — a phone in portrait — it moves
 * under the HUD panel on the left instead. On a phone, where either place can
 * land on a button, it goes instead to the clear spot nearest the top of the
 * screen's middle, scaled down as far as it must be.
 */
export function topCentreStripSlot(
  miniMap: MiniMapSystem,
  hudRect: Rect,
  width: number,
  height: number,
): StripSlot {
  const slot = stripSlotBesideHud(miniMap, hudRect, width);
  if (!platform.isMobile) return slot;
  const buttons = [...phoneHudButtonRects(miniMap), miniMapWithCaption(miniMap)];
  const drawn = { x: slot.x, y: slot.y, w: width * slot.scale, h: height * slot.scale };
  if (!buttons.some((button) => rectsOverlap(drawn, button))) return slot;
  return phoneStripRefuge(miniMap, hudRect, width, height) ?? slot;
}

/** {@link topCentreStripSlot} before a phone's buttons are taken into account. */
function stripSlotBesideHud(miniMap: MiniMapSystem, hudRect: Rect, width: number): StripSlot {
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
