/**
 * A pure viewport → layout function for the blackjack panel. No drawing, no
 * canvas, no globals — hand it a viewport and a fit scale and it resolves every
 * rect the panel needs.
 *
 * `fitModal` alone is not enough here. It scales the whole panel about the
 * viewport centre by one factor derived from height, so a 640px-tall blackjack
 * panel on a 360×640 phone would still overflow horizontally, and on a landscape
 * phone would put the action buttons below any usable touch target. So the mode
 * is chosen first and `fitModal` handles only the residual, which keeps the
 * shrink factor near 1 in both modes.
 */

import { CARD_ASPECT } from './PlayingCard';

export type CasinoLayoutMode = 'wide' | 'compact';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CasinoLayout {
  readonly mode: CasinoLayoutMode;
  readonly panel: Rect;
  /** Text area of the header, already clear of the compact mode's header bust. */
  readonly header: Rect;
  /** Null in compact mode, where the portrait becomes a slim header bust instead. */
  readonly dealerPortrait: Rect | null;
  /** The header bust, drawn only in compact mode. */
  readonly headerBust: Rect | null;
  readonly banner: Rect;
  readonly dealerHand: Rect;
  readonly playerHand: Rect;
  readonly cardWidth: number;
  readonly chipTray: Rect;
  readonly betSpot: Rect;
  readonly actionRow: Rect;
  readonly statusRow: Rect;
  readonly hintRow: Rect;
  readonly helpButton: Rect;
  readonly leaveButton: Rect;
  /** Post-fit button height, already divided back into design space. */
  readonly buttonHeight: number;
}

/** Below this width the panel switches to the stacked, two-column-button layout. */
export const WIDE_LAYOUT_MIN_WIDTH = 760;

/** A touch target must be this many *screen* pixels; design space divides by the fit. */
export const MIN_TOUCH_TARGET_PX = 44;

const WIDE_PANEL_WIDTH = 720;
const WIDE_PANEL_HEIGHT = 520;
const COMPACT_PANEL_WIDTH = 400;
const COMPACT_PANEL_HEIGHT = 600;
/** Breathing room kept between the panel and the viewport's left and right edges. */
const PANEL_SIDE_MARGIN = 24;
const PANEL_PADDING = 16;

/** Fraction of the wide panel's inner width given to the dealer portrait column. */
const PORTRAIT_COLUMN_FRACTION = 0.32;
const COLUMN_GAP = 14;
const ROW_GAP = 10;

const HEADER_HEIGHT = 46;
/** Tall enough for Deuce's longest line wrapped to the narrow portrait column. */
const BANNER_HEIGHT = 48;
const STATUS_HEIGHT = 22;
const HINT_HEIGHT = 18;
const TRAY_HEIGHT = 62;

const COMPACT_BUST_SIZE = 54;

/** Two rows of buttons in compact mode; one in wide. */
const COMPACT_ACTION_ROWS = 2;

/** How much of the leftover vertical space each hand band gets. */
const HAND_BAND_SHARE = 0.5;
const MIN_HAND_BAND_HEIGHT = 70;

/** Widest hand the felt must hold without shrinking further. */
const MAX_PLANNED_HAND_SIZE = 5;
/** Each card after the first sits this fraction of a card width along. */
export const CARD_OVERLAP_FRACTION = 0.44;
/** Overlap tightens as the hand grows, so a six-card hand still fits its band. */
const OVERLAP_TIGHTEN_PER_CARD = 0.03;
const MIN_OVERLAP_FRACTION = 0.24;
/** Per-card fan rotation, in degrees, applied about the hand's centre index. */
export const CARD_FAN_DEGREES = 2.4;
const HALF_TURN_DEGREES = 180;
const DEGREES_TO_RADIANS = Math.PI / HALF_TURN_DEGREES;
/** The fanned cards rise slightly toward the middle of the hand. */
const CARD_FAN_LIFT_FRACTION = 0.03;

const CARD_BAND_VERTICAL_PAD = 6;
const MIN_CARD_WIDTH = 26;

const HALF = 0.5;

export function casinoLayoutMode(viewportW: number): CasinoLayoutMode {
  return viewportW >= WIDE_LAYOUT_MIN_WIDTH ? 'wide' : 'compact';
}

export function casinoDesignHeight(mode: CasinoLayoutMode): number {
  return mode === 'wide' ? WIDE_PANEL_HEIGHT : COMPACT_PANEL_HEIGHT;
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/**
 * The overlap that keeps `handSize` cards inside one band width.
 *
 * Shared by the static hand renderer and the flight animation, so a card in
 * flight lands exactly where the static layout would have put it.
 */
export function overlapFractionFor(handSize: number): number {
  const tightened =
    CARD_OVERLAP_FRACTION -
    Math.max(0, handSize - MAX_PLANNED_HAND_SIZE) * OVERLAP_TIGHTEN_PER_CARD;
  return Math.max(MIN_OVERLAP_FRACTION, tightened);
}

export interface CardPlacement {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/**
 * Where each card of a hand sits inside `band`: a centred, slightly fanned
 * overlap rather than a row, so five cards still fit a 360px-wide felt.
 */
export function handSpread(
  band: Rect,
  cardWidth: number,
  handSize: number,
): ReadonlyArray<CardPlacement> {
  if (handSize <= 0) return [];
  const overlap = overlapFractionFor(handSize);
  const step = cardWidth * overlap;
  const spanWidth = cardWidth + step * (handSize - 1);
  const left = band.x + (band.width - spanWidth) * HALF;
  const height = cardWidth * CARD_ASPECT;
  const top = band.y + (band.height - height) * HALF;
  const centreIndex = (handSize - 1) * HALF;

  const placements: CardPlacement[] = [];
  for (let i = 0; i < handSize; i++) {
    const fromCentre = i - centreIndex;
    placements.push({
      x: left + step * i,
      y: top - Math.abs(fromCentre) * cardWidth * CARD_FAN_LIFT_FRACTION,
      rotation: fromCentre * CARD_FAN_DEGREES * DEGREES_TO_RADIANS,
    });
  }
  return placements;
}

/** The card width that fits `MAX_PLANNED_HAND_SIZE` cards inside a hand band. */
function cardWidthFor(band: Rect): number {
  const spanFactor = 1 + overlapFractionFor(MAX_PLANNED_HAND_SIZE) * (MAX_PLANNED_HAND_SIZE - 1);
  const byWidth = band.width / spanFactor;
  const byHeight = (band.height - CARD_BAND_VERTICAL_PAD * 2) / CARD_ASPECT;
  return Math.max(MIN_CARD_WIDTH, Math.min(byWidth, byHeight));
}

/**
 * Resolve the panel layout.
 *
 * `fitScale` is the factor `fitModal` will apply to everything drawn here. The
 * button height is derived *from* it — a 44px screen target is
 * `44 / fitScale` design pixels — so computing the fit first and the buttons
 * second is load-bearing, not incidental ordering.
 */
export function computeCasinoLayout(
  viewportW: number,
  viewportH: number,
  fitScale: number,
): CasinoLayout {
  const mode = casinoLayoutMode(viewportW);
  const designHeight = casinoDesignHeight(mode);
  const idealWidth = mode === 'wide' ? WIDE_PANEL_WIDTH : COMPACT_PANEL_WIDTH;
  const panelW = Math.min(idealWidth, Math.max(MIN_TOUCH_TARGET_PX, viewportW - PANEL_SIDE_MARGIN));
  const panelX = Math.round(viewportW * HALF - panelW * HALF);
  const panelY = Math.round(viewportH * HALF - designHeight * HALF);
  const panel = rect(panelX, panelY, panelW, designHeight);

  const buttonHeight = MIN_TOUCH_TARGET_PX / Math.max(fitScale, Number.EPSILON);
  const innerX = panelX + PANEL_PADDING;
  const innerY = panelY + PANEL_PADDING;
  const innerW = panelW - PANEL_PADDING * 2;
  const innerBottom = panelY + designHeight - PANEL_PADDING;

  return mode === 'wide'
    ? wideLayout(panel, innerX, innerY, innerW, innerBottom, buttonHeight)
    : compactLayout(panel, innerX, innerY, innerW, innerBottom, buttonHeight);
}

function wideLayout(
  panel: Rect,
  innerX: number,
  innerY: number,
  innerW: number,
  innerBottom: number,
  buttonHeight: number,
): CasinoLayout {
  const portraitW = innerW * PORTRAIT_COLUMN_FRACTION;
  const feltX = innerX + portraitW + COLUMN_GAP;
  const feltW = innerW - portraitW - COLUMN_GAP;

  // Help and Leave Table are touch targets too — on a phone, Leave Table is the
  // only way out of the panel, so it takes the same post-fit height as the
  // action row rather than a raw design-space value the fit would shrink below 44.
  const footerHeight = buttonHeight;
  const footerTop = innerBottom - footerHeight;
  const actionTop = footerTop - ROW_GAP - buttonHeight;
  const hintTop = actionTop - ROW_GAP - HINT_HEIGHT;
  const trayTop = hintTop - ROW_GAP - TRAY_HEIGHT;

  const headerBottom = innerY + HEADER_HEIGHT;
  const bandsTop = headerBottom + ROW_GAP;
  const bandsBottom = trayTop - ROW_GAP;
  const bandsHeight = Math.max(MIN_HAND_BAND_HEIGHT * 2 + STATUS_HEIGHT, bandsBottom - bandsTop);
  const handBandHeight = Math.max(
    MIN_HAND_BAND_HEIGHT,
    (bandsHeight - STATUS_HEIGHT - ROW_GAP * 2) * HAND_BAND_SHARE,
  );

  const dealerHand = rect(feltX, bandsTop, feltW, handBandHeight);
  const statusRow = rect(feltX, dealerHand.y + handBandHeight + ROW_GAP, feltW, STATUS_HEIGHT);
  const playerHand = rect(feltX, statusRow.y + STATUS_HEIGHT + ROW_GAP, feltW, handBandHeight);

  // The tray and the action row sit side by side: chips left, decisions right.
  const trayW = feltW * HAND_BAND_SHARE - COLUMN_GAP * HALF;
  const chipTray = rect(feltX, trayTop, trayW, TRAY_HEIGHT);
  const betSpot = rect(
    feltX + trayW + COLUMN_GAP,
    trayTop,
    feltW - trayW - COLUMN_GAP,
    TRAY_HEIGHT,
  );

  const portraitHeight = trayTop - innerY - BANNER_HEIGHT - ROW_GAP;
  const dealerPortrait = rect(
    innerX,
    innerY,
    portraitW,
    Math.max(MIN_HAND_BAND_HEIGHT, portraitHeight),
  );
  const banner = rect(
    innerX,
    dealerPortrait.y + dealerPortrait.height + ROW_GAP,
    portraitW,
    BANNER_HEIGHT,
  );

  const footerBtnW = (innerW - COLUMN_GAP) * HAND_BAND_SHARE;

  return {
    mode: 'wide',
    panel,
    // Centred over the felt, not the whole panel: centring across the portrait
    // column puts the title visibly off-axis from the table it names.
    header: rect(feltX, innerY, feltW, HEADER_HEIGHT),
    dealerPortrait,
    headerBust: null,
    banner,
    dealerHand,
    playerHand,
    cardWidth: cardWidthFor(dealerHand),
    chipTray,
    betSpot,
    actionRow: rect(feltX, actionTop, feltW, buttonHeight),
    statusRow,
    hintRow: rect(feltX, hintTop, feltW, HINT_HEIGHT),
    helpButton: rect(innerX, footerTop, footerBtnW, footerHeight),
    leaveButton: rect(innerX + footerBtnW + COLUMN_GAP, footerTop, footerBtnW, footerHeight),
    buttonHeight,
  };
}

function compactLayout(
  panel: Rect,
  innerX: number,
  innerY: number,
  innerW: number,
  innerBottom: number,
  buttonHeight: number,
): CasinoLayout {
  const footerHeight = buttonHeight;
  const footerTop = innerBottom - footerHeight;
  const actionHeight = buttonHeight * COMPACT_ACTION_ROWS + ROW_GAP;
  const actionTop = footerTop - ROW_GAP - actionHeight;
  const hintTop = actionTop - ROW_GAP - HINT_HEIGHT;
  const trayTop = hintTop - ROW_GAP - TRAY_HEIGHT;

  // The bust is taller than the header text block, so the banner clears whichever
  // of the two runs lower — otherwise Deuce's line runs under his own portrait.
  const headerBottom = innerY + Math.max(HEADER_HEIGHT, COMPACT_BUST_SIZE) + ROW_GAP;
  const banner = rect(innerX, headerBottom, innerW, BANNER_HEIGHT);
  const bandsTop = banner.y + BANNER_HEIGHT + ROW_GAP;
  const bandsBottom = trayTop - ROW_GAP;
  const bandsHeight = Math.max(MIN_HAND_BAND_HEIGHT * 2 + STATUS_HEIGHT, bandsBottom - bandsTop);
  const handBandHeight = Math.max(
    MIN_HAND_BAND_HEIGHT,
    (bandsHeight - STATUS_HEIGHT - ROW_GAP * 2) * HAND_BAND_SHARE,
  );

  const dealerHand = rect(innerX, bandsTop, innerW, handBandHeight);
  const statusRow = rect(innerX, dealerHand.y + handBandHeight + ROW_GAP, innerW, STATUS_HEIGHT);
  const playerHand = rect(innerX, statusRow.y + STATUS_HEIGHT + ROW_GAP, innerW, handBandHeight);

  const trayW = innerW * HAND_BAND_SHARE - COLUMN_GAP * HALF;
  const chipTray = rect(innerX, trayTop, trayW, TRAY_HEIGHT);
  const betSpot = rect(
    innerX + trayW + COLUMN_GAP,
    trayTop,
    innerW - trayW - COLUMN_GAP,
    TRAY_HEIGHT,
  );

  const footerBtnW = (innerW - COLUMN_GAP) * HAND_BAND_SHARE;

  return {
    mode: 'compact',
    panel,
    header: rect(innerX, innerY, innerW - COMPACT_BUST_SIZE - COLUMN_GAP, HEADER_HEIGHT),
    dealerPortrait: null,
    headerBust: rect(
      innerX + innerW - COMPACT_BUST_SIZE,
      innerY,
      COMPACT_BUST_SIZE,
      COMPACT_BUST_SIZE,
    ),
    banner,
    dealerHand,
    playerHand,
    cardWidth: cardWidthFor(dealerHand),
    chipTray,
    betSpot,
    actionRow: rect(innerX, actionTop, innerW, actionHeight),
    statusRow,
    hintRow: rect(innerX, hintTop, innerW, HINT_HEIGHT),
    helpButton: rect(innerX, footerTop, footerBtnW, footerHeight),
    leaveButton: rect(innerX + footerBtnW + COLUMN_GAP, footerTop, footerBtnW, footerHeight),
    buttonHeight,
  };
}
