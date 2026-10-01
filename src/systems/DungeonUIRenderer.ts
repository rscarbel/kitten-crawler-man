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
import type { PlayerManager } from '../core/PlayerManager';
import { drawText, wrapText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { drawSatchelIcon } from '../ui/icons/satchelIcon';
import { drawCompassIcon } from '../ui/icons/compassIcon';
import { drawConstructionIcon } from '../ui/icons/constructionIcon';
import { keybindings } from '../core/Keybindings';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { bestSpot } from '../ui/hudPacking';
import {
  desktopFollowerButtonRect,
  HUD_BUTTON_GAP,
  HUD_RIGHT_COLUMN_MARGIN,
  hudButtonLayout,
  LEVEL_TIMER_H,
  LEVEL_TIMER_MAX_SCALE,
  LEVEL_TIMER_W,
  miniMapWithCaption,
  OFFSCREEN_SLOT,
  phoneSummonButtonRect,
  phoneSwitchButtonRect,
  type HudButtonRects,
} from '../ui/hudButtons/hudButtonLayout';
import { HUD_MINIMAP_MARGIN } from '../ui/hudButtons/hudMiniMap';

export type Rect = { x: number; y: number; w: number; h: number };

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
const TIMER_DOUBLE_SCALE = LEVEL_TIMER_MAX_SCALE;
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
const MOBILE_BAG_ICON_SIZE = 14;
const MOBILE_BAG_ICON_PAD = 4;
const MOBILE_BAG_BADGE_RADIUS = 4;
const MOBILE_BAG_BOUNCE_SCALE_AMOUNT = 0.18;
/** Baseline of the Follower button's crawler glyph, inside the button. */
const MOBILE_FOLLOWER_ICON_BASELINE = 30;
const MOBILE_FOLLOWER_TEXT_SIZE = 10;
const MOBILE_FOLLOWER_FONT_SIZE = 22;
const MOBILE_FOLLOWER_Y_OFFSET = 14;
const MOBILE_BUTTON_TEXT_Y_OFFSET = 6;
const MOBILE_BUTTON_TEXT_Y_OFFSET_2 = 7;
const MOBILE_BUTTON_ICON_Y_OFFSET = 2;
const MOBILE_BUTTON_ICON_FONT_SIZE = 20;

/**
 * Where a phone's Follower button stands, as the phone's right-hand cluster
 * places it. Exported so every layout that keeps clear of it, and its gate,
 * measure the button that is drawn.
 */
export function mobileFollowerButtonRect(miniMap: MiniMapSystem): Rect {
  return outdoorButtonLayout(miniMap).follower;
}

/** The Pause button, under the minimap or wherever a phone's cluster found room for it. */
export function pauseButtonRect(miniMap: MiniMapSystem): Rect {
  return outdoorButtonLayout(miniMap).pause;
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
  return outdoorButtonLayout(miniMap).timer;
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
  const w = LEVEL_TIMER_W * scale;
  const h = LEVEL_TIMER_H * scale;
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
  hideSwitchButton?: boolean;
  hideFollowerButton?: boolean;
  /** Whether the viewed crawler's bag holds an unseen item upgrade — draws a badge on the Bag button. */
  hasUnseenUpgrade?: boolean;
  /** 0 (settled) to 1 (an item just landed) — squash-bounces the Bag button. */
  bagBouncePulse?: number;
}

/** A phone's Switch button, bottom left above the hotbar. */
export function mobileSwitchButtonRect(): Rect {
  return phoneSwitchButtonRect(viewportWidth(), viewportHeight());
}

/** A phone's Summon button, stacked on Switch, wherever Mongo can be summoned. */
export function mobileSummonButtonRect(): Rect {
  return phoneSummonButtonRect(viewportWidth(), viewportHeight());
}

/** The Bag button: under Pause, or wherever a phone's cluster found room for both. */
export function bagButtonRect(miniMap: MiniMapSystem): Rect {
  return outdoorButtonLayout(miniMap).bag;
}

export function renderMobileButtons(
  ctx: CanvasRenderingContext2D,
  touch: MobileTouchState,
  state: MobileButtonState,
): void {
  touch.switchBtnRect = mobileSwitchButtonRect();
  const followerRect = mobileFollowerButtonRect(state.miniMap);
  touch.bagBtnRect = bagButtonRect(state.miniMap);

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
    touch.followBtnRect = renderFollowerButton(ctx, state.companion, humanActive, followerRect);
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
    touch.summonBtnRect = { ...OFFSCREEN_SLOT };
  }
}

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
  return outdoorButtonLayout(miniMap).build;
}

/**
 * The Build button at `r`: the Construction menu's HUD entry. `pulseSeconds`
 * counts down the attention pulse it gets the first time it appears.
 */
export function drawBuildButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  menuOpen: boolean,
  pulseSeconds: number,
): Rect {
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
 * Where `AchievementUISystem`'s "🏆 NEW" chip stands when the party is not in a
 * safe room: a slot in the HUD's button column (`hudButtonLayout`), between
 * Build and the Journal.
 */
export function achievementChipRect(miniMap: MiniMapSystem): Rect {
  return outdoorButtonLayout(miniMap).chip;
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
 * Every button of the outdoor HUD, from the one layout the interior HUD uses
 * too, laid out against this frame's minimap and the state the scene has told
 * this module.
 */
function outdoorButtonLayout(miniMap: MiniMapSystem): HudButtonRects {
  return hudButtonLayout({
    viewportWidth: viewportWidth(),
    viewportHeight: viewportHeight(),
    mobile: platform.isMobile,
    miniMap: miniMap.screenRect,
    hudPanel: hudPanelRect,
    hudKeepouts: hudPanelKeepouts,
    timer: levelTimerShown,
    build: buildSlotReserved,
    lootBoxBanner: lootBoxBannerRect,
    extras: [],
  });
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

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
 * Every slot above it is reserved *unconditionally*, including the
 * achievement chip's, which only appears when there is something unread: a
 * button placed against what happens to be on screen would jump down the
 * moment an achievement was earned, and the chip is hit-tested first — so it
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
 * `hudButtonLayout`'s fallback order; only on a screen with no clear slot at
 * all can it land on other chrome.
 */
export function journalButtonRect(miniMap: MiniMapSystem): Rect {
  return outdoorButtonLayout(miniMap).journal;
}

/**
 * The Journal button at `r`, with a badge count when quests are outstanding.
 *
 * `outstanding` only changes the frame's colour, never its size: a button that
 * grew when a quest was accepted would move the thing under the player's finger
 * at the moment they were most likely to be reaching for it.
 */
export function drawJournalButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  outstanding: number,
): Rect {
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
 * Where a desktop's Follower button stands: bottom-right, clear of the hotbar.
 *
 * Exported because the right-hand HUD column has to keep clear of it —
 * anything hung under the minimap stops above it or steps aside — and
 * re-deriving that arithmetic anywhere else is how two pieces of chrome end up
 * on the same pixels.
 */
export function followerButtonRect(): Rect {
  return desktopFollowerButtonRect(viewportWidth(), viewportHeight());
}

/**
 * The Follower button at `r`, for every scene and platform. Returns `r`, the
 * rect the caller hit-tests the button against.
 */
export function renderFollowerButton(
  ctx: CanvasRenderingContext2D,
  companion: CompanionSystem,
  humanIsActive: boolean,
  r: Rect,
): Rect {
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
  drawText(ctx, companionEmoji, {
    x: r.x + r.w / 2,
    y: r.y + MOBILE_FOLLOWER_ICON_BASELINE,
    baseline: 'alphabetic',
    size: MOBILE_FOLLOWER_FONT_SIZE,
    bold: true,
    color: '#e2e8f0',
    align: 'center',
  });

  drawText(ctx, 'Follower', {
    x: r.x + r.w / 2,
    y: r.y + r.h - MOBILE_FOLLOWER_Y_OFFSET,
    size: MOBILE_FOLLOWER_TEXT_SIZE,
    bold: true,
    color: nonDefault ? '#facc15' : '#94a3b8',
    align: 'center',
  });
  return r;
}

/** Clear space kept between a top strip and the HUD pieces either side of it. */
const TOP_STRIP_SIDE_GAP = 12;
/** Top edge of a strip sharing the minimap's row. */
const TOP_STRIP_Y = HUD_MINIMAP_MARGIN;
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
  const cluster = outdoorButtonLayout(miniMap);
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
  const buttons = [...phoneHudButtonRects(miniMap), miniMapWithCaption(miniMap.screenRect)];
  const bounds: Rect = {
    x: HUD_RIGHT_COLUMN_MARGIN,
    y: TOP_STRIP_Y,
    w: screenW - HUD_RIGHT_COLUMN_MARGIN * 2,
    h: viewportHeight() - TOP_STRIP_Y - HUD_RIGHT_COLUMN_MARGIN,
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
        gap: HUD_BUTTON_GAP,
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
  const buttons = [...phoneHudButtonRects(miniMap), miniMapWithCaption(miniMap.screenRect)];
  const drawn = { x: slot.x, y: slot.y, w: width * slot.scale, h: height * slot.scale };
  if (!buttons.some((button) => rectsOverlap(drawn, button))) return slot;
  return phoneStripRefuge(miniMap, hudRect, width, height) ?? slot;
}

/** {@link topCentreStripSlot} before a phone's buttons are taken into account. */
function stripSlotBesideHud(miniMap: MiniMapSystem, hudRect: Rect, width: number): StripSlot {
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const leftBound = hudRect.x + hudRect.w + TOP_STRIP_SIDE_GAP;
  const rightBound = viewportWidth() - HUD_RIGHT_COLUMN_MARGIN - mmSize - TOP_STRIP_SIDE_GAP;
  const available = rightBound - leftBound;
  const squeeze = Math.min(1, available / width);
  if (squeeze >= TOP_STRIP_MIN_SCALE) {
    const drawnWidth = width * squeeze;
    const centred = viewportWidth() / 2 - drawnWidth / 2;
    const x = Math.min(Math.max(centred, leftBound), rightBound - drawnWidth);
    return { x, y: TOP_STRIP_Y, scale: squeeze };
  }
  const underHudWidth =
    viewportWidth() - HUD_RIGHT_COLUMN_MARGIN - mmSize - TOP_STRIP_SIDE_GAP - hudRect.x;
  const underHudScale = Math.min(1, Math.max(TOP_STRIP_MIN_SCALE, underHudWidth / width));
  return { x: hudRect.x, y: hudRect.y + hudRect.h + UNDER_HUD_GAP, scale: underHudScale };
}
