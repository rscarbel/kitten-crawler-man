/**
 * A pure viewport → layout function for the slot machine. No drawing and no
 * globals: hand it the safe area, the whole screen, the UI scale and the
 * theme's control height, and it places the cabinet, its marquee, the
 * jackpot meter, the five reels behind their glass, the readouts and every
 * control.
 *
 * - `compact` (a phone held upright): the jackpot meter rides in a header
 *   strip beside Leave and the rules, the reels fill the width, and the bet
 *   and spin controls sit in two rows below.
 * - `landscape` (a short, wide screen): the cabinet fills the height on the
 *   left and the controls stack in a rail on the right.
 * - `wide` (a desktop): the whole cabinet, its control deck, and the pull
 *   lever beside it.
 *
 * Every control is at least {@link MIN_TOUCH_TARGET_PX} tall in screen pixels.
 */

import { MIN_TOUCH_TARGET_PX } from '../casinoLayout';
import { inset, splitH, splitV, type Rect } from '../../core/geom';
import { REEL_COUNT, ROW_COUNT } from '../../../systems/casino/slots/slotReels';

export type SlotsLayoutMode = 'wide' | 'compact' | 'landscape';

export interface SlotsControlRects {
  readonly leave: Rect;
  readonly rules: Rect;
  readonly betDown: Rect;
  readonly betUp: Rect;
  readonly maxBet: Rect;
  readonly auto: Rect;
  readonly turbo: Rect;
  readonly spin: Rect;
}

export interface SlotsReadoutRects {
  readonly credits: Rect;
  readonly bet: Rect;
  readonly win: Rect;
}

export interface SlotsLayout {
  readonly mode: SlotsLayoutMode;
  readonly screen: Rect;
  /** The cabinet's outer chrome. */
  readonly cabinet: Rect;
  /** The lit sign on top, with its chasing bulbs. */
  readonly marquee: Rect;
  /** The DESPERADO JACKPOT progressive meter. */
  readonly meter: Rect;
  /** Whether the meter sits outside the cabinet, in a header strip. */
  readonly meterInHeader: boolean;
  /** The window all five reels show through. */
  readonly glass: Rect;
  /** The chrome bezel's width round the glass. */
  readonly bezel: number;
  /** One column per reel, inside the glass. */
  readonly reels: ReadonlyArray<Rect>;
  readonly cellH: number;
  readonly readouts: SlotsReadoutRects;
  /** The cabinet's lower panel the controls are set in, or null when they are outside it. */
  readonly deck: Rect | null;
  readonly controls: SlotsControlRects;
  /** The pull lever beside the cabinet, desktop only. */
  readonly lever: Rect | null;
  /** Where a win banner is centred: over the glass. */
  readonly banner: Rect;
  /** The smallest control height in UI units for this screen. */
  readonly minTarget: number;
  /** Space between controls. */
  readonly gap: number;
}

export interface SlotsLayoutInput {
  /** The safe area, in UI units. */
  readonly viewport: Rect;
  readonly screen: Rect;
  readonly uiScale: number;
  /** The theme's control height, which touch density raises. */
  readonly controlHeight: number;
}

/** A screen at least this much wider than tall, and shorter than the stacked cabinet wants, gets the side rail. */
const LANDSCAPE_MIN_ASPECT = 1.3;
const LANDSCAPE_MAX_HEIGHT = 560;
/** Narrower than this (and not landscape) is a phone held upright. */
const WIDE_MIN_WIDTH = 720;

const GAP = 10;
const MARGIN = 14;

/** The desktop cabinet is this wide for its height, before the screen's width caps it. */
const CABINET_ASPECT = 0.8;
/** The lever's width beside the desktop cabinet, as a fraction of the cabinet's width. */
const LEVER_WIDTH_FRACTION = 0.13;
/** The chrome frame's thickness, as a fraction of the cabinet's short side. */
const FRAME_FRACTION = 0.035;
const MIN_FRAME = 8;

/** The bezel round the glass, as a fraction of the reel area's width. */
const BEZEL_FRACTION = 0.022;
const MIN_BEZEL = 4;

/** Cell height over width that the reels prefer; a short screen squashes them. */
const CELL_ASPECT = 0.92;
/** A phone held upright has height to spare, so its reels stand taller. */
const COMPACT_CELL_ASPECT = 1.45;
const MIN_CELL_ASPECT = 0.62;

const WIDE_MARQUEE_FRACTION = 0.12;
const WIDE_METER_FRACTION = 0.075;
const WIDE_READOUT_FRACTION = 0.065;
/** The desktop deck's SPIN button takes this share of the deck's width. */
const WIDE_SPIN_SHARE = 0.32;

const COMPACT_MARQUEE_FRACTION = 0.24;
const COMPACT_READOUT_HEIGHT = 40;
/** The phone's SPIN row is this much taller than a plain control row. */
const SPIN_ROW_GROWTH = 1.35;
const COMPACT_SPIN_SHARE = 0.46;

const LANDSCAPE_RAIL_FRACTION = 0.31;
const LANDSCAPE_RAIL_MAX = 300;
const LANDSCAPE_MARQUEE_FRACTION = 0.13;
const LANDSCAPE_METER_FRACTION = 0.13;
const LANDSCAPE_READOUT_FRACTION = 0.1;
/** Rail rows above SPIN: Leave and rules, the bet steppers, MAX BET, autospin and turbo. */
const RAIL_ROWS_ABOVE_SPIN = 4;

/** Leave's width, in control heights, so the word fits beside its glyph. */
const LEAVE_WIDTH_IN_TARGETS = 2.2;
/** The banner's share of the glass. */
const BANNER_WIDTH_SHARE = 0.94;
const BANNER_HEIGHT_SHARE = 0.62;
const HALF = 0.5;

export function slotsLayoutMode(viewportW: number, viewportH: number): SlotsLayoutMode {
  if (viewportW >= viewportH * LANDSCAPE_MIN_ASPECT && viewportH < LANDSCAPE_MAX_HEIGHT) {
    return 'landscape';
  }
  return viewportW >= WIDE_MIN_WIDTH ? 'wide' : 'compact';
}

function minTargetFor(input: SlotsLayoutInput): number {
  return Math.max(
    MIN_TOUCH_TARGET_PX / Math.max(input.uiScale, Number.EPSILON),
    input.controlHeight,
  );
}

function frameFor(cabinet: Rect): number {
  return Math.max(MIN_FRAME, Math.min(cabinet.w, cabinet.h) * FRAME_FRACTION);
}

/** The five reel columns in `glass`, with cells as tall as `cellH`. */
function reelColumns(glass: Rect): Rect[] {
  return splitH(
    glass,
    Array.from({ length: REEL_COUNT }, () => 'fill' as const),
    0,
  );
}

/**
 * The glass for a reel area: as wide as it allows, the cells at their
 * preferred shape where the height allows, squashed (never below
 * {@link MIN_CELL_ASPECT}) where it does not, and centred.
 */
function fitGlass(
  reelArea: Rect,
  aspect = CELL_ASPECT,
): { glass: Rect; cellH: number; bezel: number } {
  const bezel = Math.max(MIN_BEZEL, reelArea.w * BEZEL_FRACTION);
  const area = inset(reelArea, bezel);
  const widestCellW = area.w / REEL_COUNT;
  const cellH = Math.min(widestCellW * aspect, area.h / ROW_COUNT);
  const cellW = Math.min(widestCellW, cellH / MIN_CELL_ASPECT);
  const glassW = cellW * REEL_COUNT;
  const glassH = cellH * ROW_COUNT;
  const glass: Rect = {
    x: area.x + (area.w - glassW) * HALF,
    y: area.y + (area.h - glassH) * HALF,
    w: glassW,
    h: glassH,
  };
  return { glass, cellH, bezel };
}

function readoutCells(row: Rect, gap: number): SlotsReadoutRects {
  const [credits, bet, win] = splitH(row, ['fill', 'fill', 'fill'], gap);
  return { credits, bet, win };
}

function bannerOver(glass: Rect): Rect {
  const w = glass.w * BANNER_WIDTH_SHARE;
  const h = glass.h * BANNER_HEIGHT_SHARE;
  return { x: glass.x + (glass.w - w) * HALF, y: glass.y + (glass.h - h) * HALF, w, h };
}

function wideLayout(input: SlotsLayoutInput, minTarget: number): SlotsLayout {
  const { viewport, screen } = input;
  const area = inset(viewport, MARGIN);
  const leave: Rect = { x: area.x, y: area.y, w: minTarget * LEAVE_WIDTH_IN_TARGETS, h: minTarget };
  const tallH = area.h;
  const maxW = area.w - (leave.w + GAP) * 2;
  const cabinetW = Math.min(tallH * CABINET_ASPECT, maxW / (1 + LEVER_WIDTH_FRACTION));
  const leverW = cabinetW * LEVER_WIDTH_FRACTION;
  const cabinet: Rect = {
    x: area.x + (area.w - cabinetW - leverW) * HALF,
    y: area.y,
    w: cabinetW,
    h: tallH,
  };
  const frame = frameFor(cabinet);
  const body = inset(cabinet, frame);
  const marqueeH = cabinet.h * WIDE_MARQUEE_FRACTION;
  const meterH = Math.max(minTarget, cabinet.h * WIDE_METER_FRACTION);
  const readoutH = Math.max(minTarget, cabinet.h * WIDE_READOUT_FRACTION);
  const deckRows = 2;
  const deckH = minTarget * deckRows + GAP * (deckRows + 1);
  const [marquee, meterRow, reelArea, readoutRow, deck] = splitV(
    body,
    [marqueeH, meterH, 'fill', readoutH, deckH],
    GAP,
  );
  const { glass, cellH, bezel } = fitGlass(inset(reelArea, { l: frame, r: frame }));
  const meter = inset(meterRow, { l: frame * 2, r: frame * 2 });
  const deckInner = inset(deck, { l: GAP, r: GAP, t: GAP, b: GAP });
  const [cluster, spin] = splitH(deckInner, ['fill', deckInner.w * WIDE_SPIN_SHARE], GAP);
  const [topRow, bottomRow] = splitV(cluster, ['fill', 'fill'], GAP);
  const [betDown, betUp, maxBet] = splitH(topRow, ['fill', 'fill', 'fill'], GAP);
  const [rules, auto, turbo] = splitH(bottomRow, ['fill', 'fill', 'fill'], GAP);
  const glassBottom = glass.y + glass.h;
  const lever: Rect = {
    x: cabinet.x + cabinet.w,
    y: marquee.y + marquee.h,
    w: leverW,
    h: glassBottom - (marquee.y + marquee.h),
  };
  return {
    mode: 'wide',
    screen,
    cabinet,
    marquee,
    meter,
    meterInHeader: false,
    glass,
    bezel,
    reels: reelColumns(glass),
    cellH,
    readouts: readoutCells(inset(readoutRow, { l: frame, r: frame }), GAP),
    deck,
    controls: { leave, rules, betDown, betUp, maxBet, auto, turbo, spin },
    lever,
    banner: bannerOver(glass),
    minTarget,
    gap: GAP,
  };
}

function compactLayout(input: SlotsLayoutInput, minTarget: number): SlotsLayout {
  const { viewport, screen } = input;
  const area = inset(viewport, { l: MARGIN, r: MARGIN, t: GAP, b: GAP });
  const spinRowH = minTarget * SPIN_ROW_GROWTH;
  const [header, cabinetArea, betRow, spinRow] = splitV(
    area,
    [minTarget, 'fill', minTarget, spinRowH],
    GAP,
  );
  const [leave, meter, rules] = splitH(
    header,
    [minTarget * LEAVE_WIDTH_IN_TARGETS, 'fill', minTarget],
    GAP,
  );
  const frame = frameFor({ ...cabinetArea, h: cabinetArea.w });
  const innerW = cabinetArea.w - frame * 2;
  const marqueeH = innerW * COMPACT_MARQUEE_FRACTION;
  const glassH = (innerW / REEL_COUNT) * COMPACT_CELL_ASPECT * ROW_COUNT;
  const wantedH = frame * 2 + marqueeH + glassH + COMPACT_READOUT_HEIGHT + GAP * 2;
  const cabinetH = Math.min(cabinetArea.h, wantedH);
  const cabinet: Rect = {
    x: cabinetArea.x,
    y: cabinetArea.y + (cabinetArea.h - cabinetH) * HALF,
    w: cabinetArea.w,
    h: cabinetH,
  };
  const body = inset(cabinet, frame);
  const [marquee, reelArea, readoutRow] = splitV(
    body,
    [marqueeH, 'fill', COMPACT_READOUT_HEIGHT],
    GAP,
  );
  const { glass, cellH, bezel } = fitGlass(reelArea, COMPACT_CELL_ASPECT);
  const [betDown, betUp, maxBet] = splitH(betRow, ['fill', 'fill', 'fill'], GAP);
  const [auto, turbo, spin] = splitH(
    spinRow,
    ['fill', 'fill', spinRow.w * COMPACT_SPIN_SHARE],
    GAP,
  );
  return {
    mode: 'compact',
    screen,
    cabinet,
    marquee,
    meter,
    meterInHeader: true,
    glass,
    bezel,
    reels: reelColumns(glass),
    cellH,
    readouts: readoutCells(readoutRow, GAP),
    deck: null,
    controls: { leave, rules, betDown, betUp, maxBet, auto, turbo, spin },
    lever: null,
    banner: bannerOver(glass),
    minTarget,
    gap: GAP,
  };
}

function landscapeLayout(input: SlotsLayoutInput, minTarget: number): SlotsLayout {
  const { viewport, screen } = input;
  const area = inset(viewport, { l: MARGIN, r: MARGIN, t: GAP, b: GAP });
  const railRowsW = minTarget * 2 + GAP;
  const railW = Math.max(railRowsW, Math.min(LANDSCAPE_RAIL_MAX, area.w * LANDSCAPE_RAIL_FRACTION));
  const [cabinet, rail] = splitH(area, ['fill', railW], GAP);
  const frame = frameFor(cabinet);
  const body = inset(cabinet, frame);
  const marqueeH = body.h * LANDSCAPE_MARQUEE_FRACTION;
  const meterH = body.h * LANDSCAPE_METER_FRACTION;
  const readoutH = body.h * LANDSCAPE_READOUT_FRACTION;
  const [marquee, meterRow, reelArea, readoutRow] = splitV(
    body,
    [marqueeH, meterH, 'fill', readoutH],
    GAP * HALF,
  );
  const { glass, cellH, bezel } = fitGlass(inset(reelArea, { l: frame, r: frame }));
  const meter = inset(meterRow, { l: frame * 2, r: frame * 2 });
  const rows = splitV(
    rail,
    [...Array.from({ length: RAIL_ROWS_ABOVE_SPIN }, () => minTarget), 'fill'],
    GAP,
  );
  const [topRow, betRow, maxRow, toggleRow, spin] = rows;
  const [leave, rules] = splitH(topRow, ['fill', minTarget], GAP);
  const [betDown, betUp] = splitH(betRow, ['fill', 'fill'], GAP);
  const [auto, turbo] = splitH(toggleRow, ['fill', 'fill'], GAP);
  return {
    mode: 'landscape',
    screen,
    cabinet,
    marquee,
    meter,
    meterInHeader: false,
    glass,
    bezel,
    reels: reelColumns(glass),
    cellH,
    readouts: readoutCells(readoutRow, GAP),
    deck: null,
    controls: { leave, rules, betDown, betUp, maxBet: maxRow, auto, turbo, spin },
    lever: null,
    banner: bannerOver(glass),
    minTarget,
    gap: GAP,
  };
}

export function computeSlotsLayout(input: SlotsLayoutInput): SlotsLayout {
  const minTarget = minTargetFor(input);
  switch (slotsLayoutMode(input.viewport.w, input.viewport.h)) {
    case 'wide':
      return wideLayout(input, minTarget);
    case 'compact':
      return compactLayout(input, minTarget);
    case 'landscape':
      return landscapeLayout(input, minTarget);
  }
}
