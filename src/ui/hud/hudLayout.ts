/**
 * Where every piece of the HUD sits, computed without drawing anything: the
 * unit frames and the coin pill top left, the minimap top right with the dock
 * under it, the hotbar bottom centre, the top band between the frames and the
 * minimap, and the toasts above the hotbar.
 *
 * Pure in its inputs and shared by both gameplay scenes, so walking through a
 * door moves nothing, a layout check can ask about any screen, and the
 * interior camera can frame a room clear of chrome it has not drawn yet.
 * Every rect is in UI units.
 */

import { HOTBAR_COUNT, QUEST_SLOT_IDX } from '../../core/ItemDefs';
import { inset, overlaps, type Rect } from '../core/geom';
import type { SizeClass } from '../core/viewport';
import { resolveTheme, type Density, type Theme } from '../theme/tokens';
import { hudButtonLayout, type HudButtonRects } from './hudButtonLayout';
import type { PackSize } from './hudPacking';

/** The minimap's side, by screen size and whether the player has expanded it. */
const MINIMAP_SIDE: Readonly<
  Record<'compact' | 'roomy', Readonly<Record<'normal' | 'expanded', number>>>
> = {
  compact: { normal: 120, expanded: 200 },
  roomy: { normal: 160, expanded: 240 },
};

/**
 * A unit frame's card, by screen size: the active crawler's, then the
 * companion's. Heights follow from the rows inside: the name, the HP meter
 * (tall enough to carry its numbers) and the XP strip.
 */
interface FrameMetrics {
  readonly activeW: number;
  readonly companionW: number;
  readonly portraitActive: number;
  readonly portraitCompanion: number;
  readonly hpActive: number;
  readonly hpCompanion: number;
  readonly xp: number;
}

const ROOMY_FRAMES: FrameMetrics = {
  activeW: 248,
  companionW: 212,
  portraitActive: 44,
  portraitCompanion: 34,
  hpActive: 16,
  hpCompanion: 14,
  xp: 4,
};

const COMPACT_FRAMES: FrameMetrics = {
  activeW: 212,
  companionW: 184,
  portraitActive: 38,
  portraitCompanion: 30,
  hpActive: 14,
  hpCompanion: 14,
  xp: 3,
};

/** Narrowest a compact frame is squeezed to beside the minimap before it may run under it. */
const COMPACT_FRAME_MIN_W = 160;
/** The companion card is this much narrower than the active one, so the active reads as primary. */
const COMPANION_INSET_W = 28;
/** The coin pill's footprint the dock keeps clear of; the drawn pill sizes to its number. */
const COIN_PILL_RESERVED_W = 120;
/** Mongo's Summon card is this many buttons wide. */
const SUMMON_WIDTH_IN_BUTTONS = 2.5;
/** Room for his portrait and the longest of his labels, 'Resting', at a pointer's small buttons. */
const SUMMON_MIN_W = 116;
/**
 * What the top band keeps for a fight's bars — a boss bar with an encounter
 * bar under it — that a touch screen's buttons stand clear of where they can.
 */
const BARS_RESERVE_W = 360;
const BARS_RESERVE_H = 150;
/** Below this the band between the frames and the minimap is too narrow for a bar; it drops under the frames. */
const TOP_BAND_MIN_W = 120;

export interface HudLayoutOptions {
  /** The safe area in UI units (`ui.viewport`). */
  readonly viewport: Rect;
  readonly size: SizeClass;
  readonly density: Density;
  readonly miniMapExpanded: boolean;
  /** Whether the Build button's slot is held. */
  readonly build: boolean;
}

export interface UnitFrameRects {
  readonly card: Rect;
  readonly portrait: Rect;
  /** The level disc on the portrait's lower-right rim. */
  readonly levelDisc: Rect;
  readonly name: Rect;
  readonly hp: Rect;
  readonly xp: Rect;
  /** The row of status pills hung under the card. */
  readonly status: Rect;
}

export interface HotbarRects {
  /** The glass strip behind the slots. */
  readonly strip: Rect;
  readonly slots: readonly Rect[];
}

export interface HudGeometry {
  readonly theme: Theme;
  readonly frames: { readonly active: UnitFrameRects; readonly companion: UnitFrameRects };
  /** Both unit frames and the coin pill: what the dock keeps clear of. */
  readonly framesBlock: Rect;
  readonly coins: Rect;
  readonly miniMap: Rect;
  /** The minimap's square at its normal size: the part no button or bar ever covers. */
  readonly normalMiniMap: Rect;
  readonly buttons: HudButtonRects;
  readonly hotbar: HotbarRects;
  /** Where the top band's entries stack from. */
  readonly topBand: Rect;
  /** What the top band slides its entries past. */
  readonly topBandObstacles: readonly Rect[];
  /** No bar in the top band reaches below this: the hotbar's top. */
  readonly topBandFloor: number;
  /** Toasts stack upward from here. */
  /** Toasts stack upward from here, no wider than the lane the bottom buttons leave. */
  readonly toastAnchor: { readonly x: number; readonly bottom: number; readonly maxWidth: number };
}

export function miniMapSide(size: SizeClass, expanded: boolean): number {
  const table = size === 'compact' ? MINIMAP_SIDE.compact : MINIMAP_SIDE.roomy;
  return expanded ? table.expanded : table.normal;
}

function frameMetrics(size: SizeClass, roomBeside: number): FrameMetrics {
  if (size !== 'compact') return ROOMY_FRAMES;
  const activeW = Math.max(COMPACT_FRAME_MIN_W, Math.min(COMPACT_FRAMES.activeW, roomBeside));
  return { ...COMPACT_FRAMES, activeW, companionW: activeW - COMPANION_INSET_W };
}

/** One card's rows, top to bottom. */
interface CardRows {
  readonly nameLine: number;
  readonly hp: number;
  readonly xp: number;
}

/** A card's padding: tighter on a compact screen, where every unit of height is the room's. */
function cardPadding(theme: Theme, size: SizeClass): number {
  return size === 'compact' ? theme.space.xs + theme.space.xxs : theme.space.sm;
}

function cardHeight(theme: Theme, pad: number, rows: CardRows): number {
  return pad * 2 + rows.nameLine + theme.space.xxs + rows.hp + theme.space.xs + rows.xp;
}

/** The parts of one card laid out inside it. */
function unitFrameRects(
  theme: Theme,
  card: Rect,
  pad: number,
  portraitSide: number,
  rows: CardRows,
  statusH: number,
): UnitFrameRects {
  const { space } = theme;
  const body = inset(card, pad);
  const side = Math.min(portraitSide, body.h);
  const portrait: Rect = {
    x: body.x,
    y: card.y + (card.h - side) / 2,
    w: side,
    h: side,
  };
  const disc = Math.round(portraitSide * LEVEL_DISC_RATIO);
  const levelDisc: Rect = {
    x: portrait.x + portrait.w - disc + space.xxs,
    y: portrait.y + portrait.h - disc + space.xxs,
    w: disc,
    h: disc,
  };
  const columnX = portrait.x + portrait.w + space.sm;
  const columnW = body.x + body.w - columnX;
  const name: Rect = { x: columnX, y: body.y, w: columnW, h: rows.nameLine };
  const hp: Rect = { x: columnX, y: name.y + name.h + space.xxs, w: columnW, h: rows.hp };
  const xp: Rect = { x: columnX, y: hp.y + hp.h + space.xs, w: columnW, h: rows.xp };
  const status: Rect = { x: card.x, y: card.y + card.h + space.xs, w: card.w, h: statusH };
  return { card, portrait, levelDisc, name, hp, xp, status };
}

/** The level disc's diameter as a fraction of the portrait's. */
const LEVEL_DISC_RATIO = 0.46;

/** A status pill's height: one overline of text in a pill. */
export function statusPillHeight(theme: Theme): number {
  return theme.type.overline.lineHeight + theme.space.xxs * 2;
}

/** The coin pill's height. */
export function coinPillHeight(theme: Theme): number {
  return theme.type.label.lineHeight + theme.space.xs * 2;
}

function hotbarRects(theme: Theme, viewport: Rect, margin: number): HotbarRects {
  const { space } = theme;
  const pad = space.sm;
  const gap = space.xs;
  const dividerExtra = space.sm;
  const gaps = gap * (HOTBAR_COUNT - 1) + dividerExtra;
  const available = viewport.w - margin * 2 - pad * 2 - gaps;
  const side = Math.max(1, Math.min(theme.size.slot, Math.floor(available / HOTBAR_COUNT)));
  const slotsW = side * HOTBAR_COUNT + gaps;
  const strip: Rect = {
    x: viewport.x + Math.floor((viewport.w - slotsW) / 2) - pad,
    y: viewport.y + viewport.h - margin - side - pad * 2,
    w: slotsW + pad * 2,
    h: side + pad * 2,
  };
  const slots: Rect[] = [];
  let x = strip.x + pad;
  for (let index = 0; index < HOTBAR_COUNT; index++) {
    if (index === QUEST_SLOT_IDX) x += dividerExtra;
    slots.push({ x, y: strip.y + pad, w: side, h: side });
    x += side + gap;
  }
  return { strip, slots };
}

/** Every HUD rect for one screen and HUD state. */
export function hudLayout(opts: HudLayoutOptions): HudGeometry {
  const theme = resolveTheme(opts.density);
  const { space } = theme;
  const margin = space.sm;
  const { viewport } = opts;
  const right = viewport.x + viewport.w - margin;
  const mapSide = miniMapSide(opts.size, opts.miniMapExpanded);
  const normalMapSide = miniMapSide(opts.size, false);
  const miniMap: Rect = { x: right - mapSide, y: viewport.y + margin, w: mapSide, h: mapSide };

  const left = viewport.x + margin;
  const top = viewport.y + margin;
  const roomBeside = right - normalMapSide - space.sm - left;
  const metrics = frameMetrics(opts.size, roomBeside);
  const statusH = statusPillHeight(theme);
  const pad = cardPadding(theme, opts.size);
  const activeRows: CardRows = {
    nameLine: theme.type.label.lineHeight,
    hp: metrics.hpActive,
    xp: metrics.xp,
  };
  const companionRows: CardRows = {
    nameLine: theme.type.caption.lineHeight,
    hp: metrics.hpCompanion,
    xp: metrics.xp,
  };
  const activeCard: Rect = {
    x: left,
    y: top,
    w: metrics.activeW,
    h: cardHeight(theme, pad, activeRows),
  };
  const active = unitFrameRects(
    theme,
    activeCard,
    pad,
    metrics.portraitActive,
    activeRows,
    statusH,
  );
  const companionCard: Rect = {
    x: left,
    y: active.status.y + active.status.h + space.xs,
    w: metrics.companionW,
    h: cardHeight(theme, pad, companionRows),
  };
  const companion = unitFrameRects(
    theme,
    companionCard,
    pad,
    metrics.portraitCompanion,
    companionRows,
    statusH,
  );
  const coins: Rect = {
    x: left,
    y: companion.status.y + companion.status.h + space.xs,
    w: COIN_PILL_RESERVED_W,
    h: coinPillHeight(theme),
  };
  const framesBlock: Rect = {
    x: left,
    y: top,
    w: Math.max(metrics.activeW, COIN_PILL_RESERVED_W),
    h: coins.y + coins.h - top,
  };

  const hotbar = hotbarRects(theme, viewport, margin);
  const button = theme.size.control;
  const summon: PackSize = {
    w: Math.max(SUMMON_MIN_W, Math.round(button * SUMMON_WIDTH_IN_BUTTONS)),
    h: button,
  };
  const normalMiniMap: Rect = {
    ...miniMap,
    x: right - normalMapSide,
    w: normalMapSide,
    h: normalMapSide,
  };
  const bandArea = topBandArea(viewport, framesBlock, miniMap, normalMapSide, theme);
  const reserveW = Math.min(BARS_RESERVE_W, bandArea.w);
  const barsReserve: Rect = {
    x: bandArea.x + (bandArea.w - reserveW) / 2,
    y: bandArea.y,
    w: reserveW,
    h: BARS_RESERVE_H,
  };
  const buttons = hudButtonLayout({
    bounds: viewport,
    packed: opts.density === 'touch',
    button,
    gap: space.sm,
    margin,
    miniMap,
    normalMiniMap,
    frames: framesBlock,
    barsReserve,
    keepouts: [active.hp, companion.hp],
    hotbar: hotbar.strip,
    summon,
    build: opts.build,
    extras: [],
  });

  const dockRects = [
    buttons.pause,
    buttons.bag,
    buttons.follower,
    buttons.chip,
    buttons.journal,
    buttons.summon,
    ...(buttons.build === null ? [] : [buttons.build]),
    ...(buttons.switchButton === null ? [] : [buttons.switchButton]),
  ];
  const topBand = trimmedBand(bandArea, dockRects, space.sm);
  return {
    theme,
    frames: { active, companion },
    framesBlock,
    coins,
    miniMap,
    normalMiniMap,
    buttons,
    hotbar,
    topBand,
    // The normal minimap's square, not the expanded one: the player expands it
    // to look for a moment, and the bars may lie over the part it grew into.
    topBandObstacles: [...dockRects, hotbar.strip, normalMiniMap],
    topBandFloor: hotbar.strip.y - space.sm,
    toastAnchor: toastAnchor(hotbar.strip, dockRects, theme),
  };
}

/**
 * The band with its right edge pulled in to the leftmost button standing in
 * its top rows — a short screen's dock spills left of the minimap — so a bar
 * is narrowed to fit beside the buttons rather than slid down past them.
 */
function trimmedBand(band: Rect, buttons: readonly Rect[], gap: number): Rect {
  const rows = { ...band, h: BARS_RESERVE_H };
  let right = band.x + band.w;
  for (const button of buttons) {
    const inRows = overlaps(button, rows);
    const rightOfMiddle = button.x > band.x + band.w / 2;
    if (inRows && rightOfMiddle) right = Math.min(right, button.x - gap);
  }
  return { ...band, w: Math.max(0, right - band.x) };
}

/** How far above the hotbar the toast stack reaches, for finding the buttons beside it. */
const TOAST_ZONE_H = 120;

/**
 * Toasts stack above the hotbar's middle, as wide as the lane between the
 * buttons standing beside that stretch of screen — Summon and the switch on
 * the left, the Follower on the right — so a long notice wraps rather than
 * running under a button.
 */
function toastAnchor(
  strip: Rect,
  buttons: readonly Rect[],
  theme: Theme,
): { x: number; bottom: number; maxWidth: number } {
  const x = strip.x + strip.w / 2;
  const bottom = strip.y - theme.space.md;
  const zoneTop = bottom - TOAST_ZONE_H;
  let left = -Infinity;
  let right = Infinity;
  for (const button of buttons) {
    if (button.y + button.h <= zoneTop || button.y >= bottom) continue;
    if (button.x + button.w <= x) left = Math.max(left, button.x + button.w);
    else if (button.x >= x) right = Math.min(right, button.x);
  }
  const halfLane = Math.min(x - left, right - x) - theme.space.sm;
  return { x, bottom, maxWidth: Math.max(0, Math.min(strip.w, halfLane * 2)) };
}

/**
 * Between the unit frames and the minimap where that gap is wide enough for a
 * bar — a desktop, or a phone on its side; otherwise — a phone upright — under
 * the frames, as wide as the minimap allows.
 */
function topBandArea(
  viewport: Rect,
  framesBlock: Rect,
  miniMap: Rect,
  normalMapSide: number,
  theme: Theme,
): Rect {
  const { space } = theme;
  const margin = space.sm;
  const top = viewport.y + margin;
  const mapLeft = viewport.x + viewport.w - margin - normalMapSide;
  const besideLeft = framesBlock.x + framesBlock.w + space.lg;
  const besideRight = mapLeft - space.lg;
  if (besideRight - besideLeft >= TOP_BAND_MIN_W) {
    return { x: besideLeft, y: top, w: besideRight - besideLeft, h: miniMap.h };
  }
  const underTop = framesBlock.y + framesBlock.h + space.sm;
  const underRight = mapLeft - space.sm;
  return {
    x: framesBlock.x,
    y: underTop,
    w: Math.max(0, underRight - framesBlock.x),
    h: Math.max(0, viewport.y + viewport.h - underTop),
  };
}
