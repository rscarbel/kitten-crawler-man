/**
 * A pure viewport → layout function for the Texas Hold'em table. No drawing,
 * no canvas, no globals: hand it the safe area's size, the UI scale and the
 * theme, and it resolves every rect and point the table paints or hit-tests.
 *
 * The mode is picked first from the viewport's shape (a wide horizontal oval,
 * a tall phone oval, or a short landscape screen with the controls in a column
 * beside the felt), and only then is the residual fitted: the felt takes
 * whatever the fixed rows leave, and the seat plates shrink only when the felt
 * would otherwise be too small to hold them.
 *
 * Every control is at least {@link MIN_TOUCH_TARGET_PX} tall in screen pixels,
 * whatever the UI size, so a phone on the Small setting still gets real targets.
 */

import { MIN_TOUCH_TARGET_PX } from './casinoLayout';
import { CARD_ASPECT } from './PlayingCard';
import { centerIn, inset, splitH, splitV, type Rect } from '../core/geom';
import type { Theme } from '../theme/tokens';

export type PokerLayoutMode = 'wide' | 'compact' | 'landscape';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where everything belonging to one seat sits. */
export interface PokerSeatLayout {
  /** The plate's centre on the rail. */
  readonly anchor: Point;
  readonly plate: Rect;
  /** The round avatar, overhanging the plate's left end. */
  readonly avatar: Rect;
  /** The name and stack lines, right of the avatar. */
  readonly info: Rect;
  /** The two hole cards: small backs tucked behind the plate, or the player's own big cards. */
  readonly holeCards: Rect;
  /** The cards turned face up at showdown, large enough to read. */
  readonly shownCards: Rect;
  /** Where the showdown hand's name is set, centred: under or beside the shown cards, or under the plate. */
  readonly handName: Rect;
  /**
   * Nothing on the felt was clear for this seat's shown hand, so its cards
   * cover the avatar and its name sits on one line against them.
   */
  readonly shownFallback: boolean;
  /** The last-action tag, hanging under the plate. */
  readonly tag: Rect;
  /** The centre of this seat's bet on the felt. */
  readonly betSpot: Point;
  /** Which side of the bet's chips its amount is printed on, away from whatever is beside it. */
  readonly betLabelSide: 'left' | 'right';
  /** Where the dealer puck sits when this seat has the button. */
  readonly buttonSpot: Point;
  /** The small or big blind marker, on the avatar's lower left rim, clear of the name, the tag and the cards. */
  readonly blindMarker: Point;
  /** The unit direction from the plate towards the middle of the felt. */
  readonly towardCentre: Point;
  /**
   * Where a speech bubble beside this seat points to: the top of the plate,
   * with the side the bubble should grow towards so it stays on the felt.
   */
  readonly bubbleAnchor: Point;
  readonly bubbleSide: 'left' | 'right';
}

export interface PokerHeaderLayout {
  /** Deuce's bust. */
  readonly bust: Rect;
  /** His banter line beside the bust. */
  readonly banter: Rect;
  /** The tier's name. */
  readonly title: Rect;
  /** Blinds and the hand number. */
  readonly info: Rect;
}

export interface PokerFooterLayout {
  readonly rules: Rect;
  readonly history: Rect;
  readonly fast: Rect;
  readonly showCards: Rect;
  readonly leave: Rect;
  /** Too narrow for words: Rules, History and the toggles show their glyphs alone. */
  readonly iconsOnly: boolean;
  /** Leave shows its glyph alone as well. */
  readonly leaveIconOnly: boolean;
}

export interface PokerLayout {
  readonly mode: PokerLayoutMode;
  readonly panel: Rect;
  readonly header: PokerHeaderLayout;
  /** The felt oval's bounding box; the rail is painted round it. */
  readonly felt: Rect;
  readonly railWidth: number;
  readonly seats: ReadonlyArray<PokerSeatLayout>;
  /** The five community card slots, left to right. */
  readonly board: ReadonlyArray<Rect>;
  readonly boardCardWidth: number;
  /** The pot readout above the board. */
  readonly pot: Rect;
  /** Where the side pots line up, under the board. */
  readonly sidePots: Rect;
  /** The pot's chips, which bets sweep into and awards sweep out of. */
  readonly potSpot: Point;
  /** The deck cards are dealt from, left of the pot readout. */
  readonly deck: Point;
  /** The burn and muck pile, right of the pot readout. */
  readonly muck: Point;
  /** Whether the deck and muck piles are drawn; a cramped felt leaves them out for the seats' sake. */
  readonly showPiles: boolean;
  /** The size of a card back on the deck and the muck pile. */
  readonly pileCardWidth: number;
  /** The "Your hand" line. */
  readonly handLabel: Rect;
  readonly actionBar: Rect;
  /** Rows the action bar's buttons wrap to. */
  readonly actionRows: number;
  /** The raise sizing tray, opened over the action bar. */
  readonly raiseTray: Rect;
  /** Rows the tray holds: presets, the amount and the confirm on three, or the last two shared on two. */
  readonly trayRows: number;
  readonly footer: PokerFooterLayout;
  /** Every control's height, in UI units: never below the touch minimum in screen pixels. */
  readonly controlHeight: number;
  readonly chipRadius: number;
}

/** A screen at least this much taller than wide is a phone held upright: the tall oval. */
const PORTRAIT_MIN_ASPECT = 1.15;
/** Below this height the felt and the controls go side by side. */
const STACKED_MIN_HEIGHT = 520;
/** Below this width a not-quite-portrait screen still takes the phone layout. */
const WIDE_MIN_WIDTH = 640;

export function pokerLayoutMode(width: number, height: number): PokerLayoutMode {
  if (height >= width * PORTRAIT_MIN_ASPECT) return 'compact';
  if (height < STACKED_MIN_HEIGHT) return 'landscape';
  if (width < WIDE_MIN_WIDTH) return 'compact';
  return 'wide';
}

/** Per-mode measures, in UI units at a fit of 1. */
interface ModeMetrics {
  readonly maxPanelW: number;
  readonly maxPanelH: number;
  readonly margin: number;
  readonly padding: number;
  readonly headerH: number;
  readonly plateW: number;
  readonly plateH: number;
  /** How far the avatar overhangs the plate above and below. */
  readonly avatarOverhang: number;
  readonly maxPlayerCardW: number;
  readonly maxBoardCardW: number;
  readonly sectionGap: number;
  /**
   * How far the side seats sit from the felt's middle row, as a share of the
   * seat oval's height: a tall phone oval pushes them apart to make room for
   * the board between them.
   */
  readonly sideRise: number;
}

const WIDE_METRICS: ModeMetrics = {
  maxPanelW: 1440,
  maxPanelH: 980,
  margin: 16,
  padding: 16,
  headerH: 60,
  plateW: 196,
  plateH: 54,
  avatarOverhang: 4,
  maxPlayerCardW: 80,
  maxBoardCardW: 84,
  sectionGap: 12,
  sideRise: 0.5,
};

const COMPACT_METRICS: ModeMetrics = {
  maxPanelW: 600,
  maxPanelH: 1100,
  margin: 8,
  padding: 12,
  headerH: 44,
  plateW: 128,
  plateH: 38,
  avatarOverhang: 3,
  maxPlayerCardW: 60,
  maxBoardCardW: 60,
  sectionGap: 8,
  sideRise: 0.62,
};

const LANDSCAPE_METRICS: ModeMetrics = {
  maxPanelW: 1180,
  maxPanelH: 720,
  margin: 4,
  padding: 8,
  headerH: 36,
  plateW: 104,
  plateH: 34,
  avatarOverhang: 2,
  maxPlayerCardW: 58,
  maxBoardCardW: 52,
  sectionGap: 6,
  sideRise: 0.52,
};

/** A compact phone's plates grow with a roomier screen, up to this much, so a tablet held upright isn't sparse. */
const COMPACT_MAX_GROWTH = 1.35;
const COMPACT_REFERENCE_WIDTH = 330;
/** A big desktop screen's table grows the same way, up to this much. */
const WIDE_MAX_GROWTH = 1.25;
const WIDE_REFERENCE_WIDTH = 1150;
/** The felt has to be at least this big at a fit of 1; smaller, and the plates shrink to the residual. */
const MIN_FELT_W_PER_PLATE = 3.2;
const MIN_FELT_H_PER_PLATE = 6.4;
/** The plates never shrink below this share of their size: below it the names stop being readable. */
const MIN_PLATE_FIT = 0.82;

/** The share of the landscape panel's width the control column takes. */
const LANDSCAPE_COLUMN_SHARE = 0.36;
/** Footer controls in the landscape column, each at least a touch target wide. */
const LANDSCAPE_FOOTER_SLOTS = 5;
/** The gaps between the landscape column's fixed rows: header, cards, hand line, actions, footer. */
const LANDSCAPE_COLUMN_GAPS = 4;

/**
 * Seats clockwise from the player at the bottom, as unit offsets on the seat
 * oval (y grows downward): bottom, lower left, upper left, top, upper right,
 * lower right. The side seats' height comes from the mode's `sideRise`.
 */
const SEAT_DIRECTIONS = [
  { x: 0, side: 0 },
  { x: -1, side: 1 },
  { x: -1, side: -1 },
  { x: 0, side: 0 },
  { x: 1, side: -1 },
  { x: 1, side: 1 },
] as const;
const PLAYER_SEAT_INDEX = 0;
const TOP_SEAT_INDEX = 3;
const LOWER_LEFT_SEAT_INDEX = 1;
const UPPER_LEFT_SEAT_INDEX = 2;

/** The felt sits a little inside the plates' outer edges, so side plates ride the rail. */
const FELT_SIDE_INSET_FRACTION = 0.22;
const RAIL_WIDTH_FRACTION = 0.34;

const BOARD_CARD_COUNT = 5;
/** The board may span this share of the felt's width at its widest. */
const BOARD_WIDTH_SHARE = 0.86;
const MIN_BOARD_CARD_W = 30;
/** Below this the board's corner indices get hard to read, and the layout makes room another way. */
const READABLE_BOARD_CARD_W = 52;
/** The pile cards at the deck and muck are this share of a board card. */
const PILE_CARD_FRACTION = 0.48;

/** A seat's tucked card backs: their width as a share of the plate's height. */
const TUCKED_CARD_FRACTION = 0.62;
/** How much of a tucked card shows above the plate. */
const TUCKED_CARD_PEEK = 0.55;
/** Each tucked card sits this share of a card width right of the one before. */
export const TUCKED_CARD_STEP = 0.55;
/** The showdown cards: their width as a share of a board card. */
const SHOWN_CARD_FRACTION = 0.86;
/** A shown hand's name may run this many times the width of its two cards, and that much room is kept for it. */
export const SHOWN_LABEL_SPANS = 1.6;
/** However small the cards, room for "Sevens full of 3s" on the name's second line. */
export const SHOWN_LABEL_MIN_WIDTH = 112;
/** A name slid along its cards keeps at least this much of its width over theirs. */
const SIDEWAYS_OVERLAP = 1;
/** A name cut to one line of shorthand ("10-high straight", "7s & 3s") needs this much. */
const SHOWN_LABEL_ONE_LINE_WIDTH = 92;
/** A shown card is never drawn narrower than this, so its rank stays readable. */
const SHOWN_CARD_MIN_WIDTH = 26;
/** Each smaller size a shown hand tries is this share of the one before. */
const SHOWN_HAND_SHRINK = 0.85;
/**
 * How much further a one-line name may sit from its plate before a two-line
 * one is preferred, in UI units: the kind of hand is worth a little distance.
 */
const ONE_LINE_NAME_PENALTY = 24;
/** The two shown cards overlap by this share of a card width. */
export const SHOWN_CARD_STEP = 0.62;
/** The player's own two cards sit this share of a card width apart, overlapping a little. */
export const PLAYER_CARD_STEP = 0.9;
/** The player's own cards are never narrower than this, however cramped the felt: they are the hand being played. */
export const PLAYER_CARD_MIN_WIDTH = 36;
/** The player's cards' height as a share of the felt's height in a stacked layout. */
const PLAYER_CARD_HEIGHT_SHARE = 0.22;

const TAG_HEIGHT = 16;
/** A card in the winning five lifts this share of its height out of its slot. */
export const WIN_LIFT_FRACTION = 0.14;
/** The pot and side-pot lines never run wider than this, however wide the board. */
const POT_LINE_MAX_WIDTH = 76;
const HAND_NAME_LINES = 2;
/** The name stops this many plate-heights short of the plate's end. */
const BLIND_MARKER_ROOM = 0.32;
/** The name row's width a plate never squeezes below: enough for an eight-letter short name. */
const SHORT_NAME_INFO_WIDTH = 60;
/** The blind marker rides the avatar's lower left rim, an eighth of a turn round from straight down. */
const EIGHTHS_PER_TURN = 8;
const BLIND_MARKER_ANGLE = (Math.PI * 2) / EIGHTHS_PER_TURN;
/** The last-action tag hangs just under its plate, clear of the stack line. */
const TAG_GAP = 1;
const CHIP_RADIUS_FRACTION = 0.32;
const MIN_CHIP_RADIUS = 8;
const BUTTON_PUCK_GAP = 2.4;
const TRAY_FULL_ROWS = 3;
const TRAY_FOLDED_ROWS = 2;
const COMPACT_ACTION_ROWS = 2;
const WIDE_ACTION_BAR_MAX_W = 760;
/** The labelled footer's widest controls; narrower than this and the footer goes to glyphs. */
const LABELLED_FOOTER_MIN_W = 640;
/** Leave keeps its word once it is at least this many controls wide. */
const LABELLED_LEAVE_MIN_CONTROLS = 2;

const HALF = 0.5;

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

function rectAround(centre: Point, w: number, h: number): Rect {
  return rect(centre.x - w * HALF, centre.y - h * HALF, w, h);
}

function metricsFor(mode: PokerLayoutMode): ModeMetrics {
  switch (mode) {
    case 'wide':
      return WIDE_METRICS;
    case 'compact':
      return COMPACT_METRICS;
    case 'landscape':
      return LANDSCAPE_METRICS;
  }
}

export interface PokerLayoutInput {
  /** The safe area, in UI units; the layout is relative to its top left. */
  readonly width: number;
  readonly height: number;
  /** CSS pixels per UI unit, for the touch minimum. */
  readonly uiScale: number;
  readonly theme: Theme;
}

/** The control height that is a touch target in screen pixels at `uiScale`. */
export function pokerControlHeight(theme: Theme, uiScale: number): number {
  return Math.max(theme.size.control, MIN_TOUCH_TARGET_PX / Math.max(uiScale, Number.EPSILON));
}

interface PlateSize {
  readonly w: number;
  readonly h: number;
  readonly overhang: number;
}

interface FeltPlan {
  readonly area: Rect;
  readonly sideRise: number;
  /**
   * A showdown hand is laid over its own plate rather than out on the felt,
   * where a phone's board has no room to spare for it.
   */
  readonly shownOverPlate: boolean;
  readonly plate: PlateSize;
  /** The player's two big cards' size, or null when they live outside the felt. */
  readonly playerCards: { readonly w: number; readonly h: number } | null;
  readonly maxBoardCardW: number;
  readonly gap: number;
  readonly tagH: number;
  /** A shown hand's name: its kind and what decides it, on two lines. */
  readonly nameH: number;
  readonly nameLineH: number;
}

interface FeltResult {
  readonly felt: Rect;
  readonly railWidth: number;
  readonly seats: PokerSeatLayout[];
  readonly board: Rect[];
  readonly boardCardWidth: number;
  readonly pot: Rect;
  readonly sidePots: Rect;
  readonly potSpot: Point;
  readonly deck: Point;
  readonly muck: Point;
  /** Whether the deck and muck piles are drawn; a cramped felt leaves them out for the seats' sake. */
  readonly showPiles: boolean;
  readonly pileCardWidth: number;
  readonly chipRadius: number;
  /** The board, the pot and the piles clear every plate, so nothing on the felt sits on a seat. */
  readonly boardClear: boolean;
}

function plateParts(
  plate: Rect,
  size: PlateSize,
  tagH: number,
): Pick<PokerSeatLayout, 'avatar' | 'info' | 'tag' | 'holeCards' | 'blindMarker'> {
  const avatarSide = size.h + size.overhang * 2;
  const avatar = rect(plate.x - size.overhang, plate.y - size.overhang, avatarSide, avatarSide);
  const infoX = avatar.x + avatarSide + size.overhang * 2;
  const markerRoom = size.h * BLIND_MARKER_ROOM;
  const info = rect(infoX, plate.y, plate.x + plate.w - infoX - markerRoom, plate.h);
  const tagW = plate.w * HALF;
  const tag = rect(
    plate.x + plate.w * HALF - tagW * HALF + avatarSide * HALF * HALF,
    plate.y + plate.h + TAG_GAP,
    tagW,
    tagH,
  );
  const cardW = size.h * TUCKED_CARD_FRACTION;
  const cardH = cardW * CARD_ASPECT;
  const cardsW = cardW * (1 + TUCKED_CARD_STEP);
  const holeCards = rect(
    info.x + info.w * HALF - cardsW * HALF,
    plate.y - cardH * TUCKED_CARD_PEEK,
    cardsW,
    cardH,
  );
  return {
    avatar,
    info,
    tag,
    holeCards,
    blindMarker: {
      x: avatar.x + avatarSide * HALF - Math.sin(BLIND_MARKER_ANGLE) * avatarSide * HALF,
      y: avatar.y + avatarSide * HALF + Math.cos(BLIND_MARKER_ANGLE) * avatarSide * HALF,
    },
  };
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: -1 };
  return { x: dx / length, y: dy / length };
}

/** How far a w×h box reaches from its centre along unit direction `dir`. */
function reachAlong(dir: Point, w: number, h: number): number {
  return Math.abs(dir.x) * w * HALF + Math.abs(dir.y) * h * HALF;
}

function along(origin: Point, dir: Point, distance: number): Point {
  return { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance };
}

function pointInRect(point: Point, r: Rect, pad: number): boolean {
  return (
    point.x >= r.x - pad &&
    point.x <= r.x + r.w + pad &&
    point.y >= r.y - pad &&
    point.y <= r.y + r.h + pad
  );
}

/**
 * The oval, the six seats round it and the board in its middle. Seat 0, the
 * player, sits bottom centre; in a stacked layout its plate shares the bottom
 * of the felt with the player's own big cards.
 */
function layOutFelt(plan: FeltPlan): FeltResult {
  const { area, plate, gap, tagH } = plan;
  const tagDrop = tagH + TAG_GAP;
  const tuckedCardH = plate.h * TUCKED_CARD_FRACTION * CARD_ASPECT;
  const peek = tuckedCardH * TUCKED_CARD_PEEK;
  const playerGroupH = Math.max(plate.h, plan.playerCards?.h ?? 0);
  const playerGroupW =
    plan.playerCards === null
      ? plate.w
      : plate.w + gap + plan.playerCards.w * (1 + PLAYER_CARD_STEP);

  const cx = area.x + area.w * HALF;
  const topCentreY = area.y + peek + plate.h * HALF + plate.overhang;
  const bottomCentreY = area.y + area.h - Math.max(playerGroupH * HALF, plate.h * HALF + tagDrop);
  const cy = (topCentreY + bottomCentreY) * HALF;
  const seatRy = Math.max(0, (bottomCentreY - topCentreY) * HALF);
  const seatRx = Math.max(0, area.w * HALF - plate.w * HALF);

  const feltRx = area.w * HALF - plate.w * FELT_SIDE_INSET_FRACTION;
  const feltRy = seatRy;
  const felt = rect(cx - feltRx, cy - feltRy, feltRx * 2, feltRy * 2);
  const railWidth = plate.h * RAIL_WIDTH_FRACTION;

  const chipRadius = Math.max(MIN_CHIP_RADIUS, plate.h * CHIP_RADIUS_FRACTION);
  // The side seats rise as far as the mode asks. Where a side seat shares
  // columns with the top seat or the player's cards it stops short of them;
  // it always stays on the felt, and the upper and lower seats on one side
  // never touch each other.
  const bottomGroupTop = bottomCentreY - playerGroupH * HALF;
  const sideInnerEdge = seatRx - plate.w * HALF;
  const sharesColumnsWithPlayer = sideInnerEdge < playerGroupW * HALF + gap;
  const sharesColumnsWithTop = sideInnerEdge < plate.w * HALF + gap;
  const lowerToPlayer = bottomGroupTop - gap - tagDrop - plate.h * HALF - cy;
  const upperToTop = cy - (topCentreY + plate.h * HALF + tagDrop + gap + peek + plate.h * HALF);
  const lowerToFloor = area.y + area.h - tagDrop - plate.h * HALF - cy;
  const upperToCeiling = cy - (area.y + peek + plate.h * HALF);
  const ceiling = Math.min(
    plan.sideRise * seatRy,
    lowerToFloor,
    upperToCeiling,
    sharesColumnsWithPlayer ? lowerToPlayer : Number.POSITIVE_INFINITY,
    sharesColumnsWithTop ? upperToTop : Number.POSITIVE_INFINITY,
  );
  const apart = (plate.h + peek + tagDrop + gap) * HALF;
  const sideOffset = Math.max(apart, ceiling);
  const anchors = SEAT_DIRECTIONS.map((direction, index) => {
    if (index === PLAYER_SEAT_INDEX) return { x: cx, y: bottomCentreY };
    if (index === TOP_SEAT_INDEX) return { x: cx, y: topCentreY };
    return { x: cx + direction.x * seatRx, y: cy + direction.side * sideOffset };
  });

  // The board sits in the middle of the felt with the pot readout over it
  // and the side pots under it; the deck and muck piles flank it when the
  // side seats leave room, and sit over its ends otherwise. A board narrow
  // enough to pass between the side seats only has to clear the top seat and
  // the player; when even that leaves it too small to read, those two seats'
  // bets move beside their plates. Otherwise the board fits between the upper
  // and lower side seats.
  const potLineH = tagH;
  const betReach = gap + chipRadius * 2 + gap;
  const topSeatBottom = topCentreY + plate.h * HALF + tagDrop;
  const byWidth =
    (feltRx * 2 * BOARD_WIDTH_SHARE - gap * (BOARD_CARD_COUNT - 1)) / BOARD_CARD_COUNT;
  const boardWidthFor = (cardW: number): number =>
    cardW * BOARD_CARD_COUNT + gap * (BOARD_CARD_COUNT - 1);
  const pileWidthFor = (cardW: number): number => cardW * PILE_CARD_FRACTION;
  const planFor = (bandH: number): { readonly cardW: number; readonly pilesBeside: boolean } => {
    const besideW = Math.min(
      plan.maxBoardCardW,
      byWidth,
      (bandH - potLineH * 2 - gap * 2) / CARD_ASPECT,
    );
    const besideReach = boardWidthFor(besideW) * HALF + gap + pileWidthFor(besideW) + gap;
    if (besideReach <= sideInnerEdge) return { cardW: besideW, pilesBeside: true };
    const aboveRatio = CARD_ASPECT + PILE_CARD_FRACTION * CARD_ASPECT;
    const aboveW = Math.min(plan.maxBoardCardW, byWidth, (bandH - potLineH - gap * 2) / aboveRatio);
    return { cardW: aboveW, pilesBeside: false };
  };
  const passes = (choice: { readonly cardW: number; readonly pilesBeside: boolean }): boolean => {
    const piles = choice.pilesBeside ? pileWidthFor(choice.cardW) + gap : 0;
    return boardWidthFor(choice.cardW) * HALF + piles + gap <= sideInnerEdge;
  };
  const betsInFront = planFor(bottomGroupTop - betReach - (topSeatBottom + betReach));
  const betsAside = planFor(bottomGroupTop - gap - (topSeatBottom + gap));
  const sideBandH =
    anchors[LOWER_LEFT_SEAT_INDEX].y -
    plate.h * HALF -
    peek -
    (anchors[UPPER_LEFT_SEAT_INDEX].y + plate.h * HALF + tagDrop) -
    gap * 2;
  const frontReadable = passes(betsInFront) && betsInFront.cardW >= READABLE_BOARD_CARD_W;
  const band: 'front' | 'aside' | 'sides' = frontReadable
    ? 'front'
    : passes(betsAside)
      ? 'aside'
      : 'sides';
  const chosen = band === 'front' ? betsInFront : band === 'aside' ? betsAside : planFor(sideBandH);
  const boardCardWidth = Math.max(MIN_BOARD_CARD_W, chosen.cardW);
  const pilesBeside = chosen.pilesBeside;
  const bandTop =
    band === 'front'
      ? topSeatBottom + betReach
      : band === 'aside'
        ? topSeatBottom + gap
        : anchors[UPPER_LEFT_SEAT_INDEX].y + plate.h * HALF + tagDrop + gap;
  const bandBottom =
    band === 'front'
      ? bottomGroupTop - betReach
      : band === 'aside'
        ? bottomGroupTop - gap
        : anchors[LOWER_LEFT_SEAT_INDEX].y - plate.h * HALF - peek - gap;
  const boardCardH = boardCardWidth * CARD_ASPECT;
  const pileCardWidth = pileWidthFor(boardCardWidth);
  const aboveH = pilesBeside ? potLineH : Math.max(potLineH, pileCardWidth * CARD_ASPECT);
  const boardW = boardWidthFor(boardCardWidth);
  const blockH = aboveH + gap + boardCardH + gap + potLineH;
  const blockTop = (bandTop + bandBottom) * HALF - blockH * HALF;
  const boardY = blockTop + aboveH + gap;
  const boardRow = rect(cx - boardW * HALF, boardY, boardW, boardCardH);
  const board = splitH(
    boardRow,
    Array.from({ length: BOARD_CARD_COUNT }, () => boardCardWidth),
    gap,
  );
  const aboveY = blockTop + aboveH * HALF;
  const boardMidY = boardY + boardCardH * HALF;
  const pileH = pileCardWidth * CARD_ASPECT;
  /**
   * The pot's line, the side pots' line and the piles. Roomy: the lines span
   * the board, with the piles at the ends of the pot's (or beside the board).
   * Tight: the lines keep to the board's middle and the piles are not drawn,
   * so a narrow felt's seats can sit beside the board's ends.
   */
  const readouts = (tight: boolean) => {
    const lineW = tight ? Math.min(boardW, POT_LINE_MAX_WIDTH) : boardW;
    const lineX = cx - lineW * HALF;
    const pileInset = tight || pilesBeside ? 0 : pileCardWidth;
    const potLine = rect(
      lineX + pileInset,
      aboveY - potLineH * HALF,
      lineW - pileInset * 2,
      potLineH,
    );
    const sideLine = rect(lineX, boardY + boardCardH + gap, lineW, potLineH);
    const deckAt = pilesBeside
      ? { x: boardRow.x - gap - pileCardWidth * HALF, y: boardMidY }
      : { x: lineX + pileCardWidth * HALF, y: aboveY };
    const muckAt = pilesBeside
      ? { x: boardRow.x + boardW + gap + pileCardWidth * HALF, y: boardMidY }
      : { x: lineX + lineW - pileCardWidth * HALF, y: aboveY };
    const piles = tight
      ? []
      : [rectAround(deckAt, pileCardWidth, pileH), rectAround(muckAt, pileCardWidth, pileH)];
    return { pot: potLine, sidePots: sideLine, deck: deckAt, muck: muckAt, piles };
  };
  const potSpot = { x: cx, y: aboveY };
  const boardBlock = rect(boardRow.x, blockTop, boardW, blockH);
  const betsBesidePlate = band === 'aside';
  const centre = { x: cx, y: cy };

  const seats = anchors.map((anchor, index): PokerSeatLayout => {
    const isPlayer = index === PLAYER_SEAT_INDEX;
    const plateX =
      isPlayer && plan.playerCards !== null
        ? anchor.x - playerGroupW * HALF
        : anchor.x - plate.w * HALF;
    const plateRect = rect(plateX, anchor.y - plate.h * HALF, plate.w, plate.h);
    const plateCentre = { x: plateRect.x + plate.w * HALF, y: anchor.y };
    const parts = plateParts(plateRect, plate, tagH);
    const towardCentre = unit(plateCentre, centre);
    const reach = reachAlong(towardCentre, plate.w, plate.h);
    const facesBoard = index === PLAYER_SEAT_INDEX || index === TOP_SEAT_INDEX;
    const besidePlate = betsBesidePlate && facesBoard;
    let betSpot = besidePlate
      ? { x: parts.avatar.x - gap - chipRadius, y: anchor.y }
      : along(plateCentre, towardCentre, reach + gap + chipRadius * 2);
    if (!besidePlate && pointInRect(betSpot, boardBlock, chipRadius)) {
      const above = betSpot.y < cy;
      betSpot = {
        x: betSpot.x,
        y: above ? boardBlock.y - chipRadius * 2 : boardBlock.y + boardBlock.h + chipRadius * 2,
      };
    }
    const perpendicular = { x: -towardCentre.y, y: towardCentre.x };
    // The puck keeps to the avatar's side of the player's bet: the far end of
    // the plate carries the blind marker.
    const sideSign = isPlayer ? -1 : plateCentre.x <= cx ? 1 : -1;
    const buttonSpot = along(betSpot, perpendicular, chipRadius * BUTTON_PUCK_GAP * sideSign);
    const holeCards =
      isPlayer && plan.playerCards !== null
        ? rect(
            plateRect.x + plate.w + gap,
            anchor.y - plan.playerCards.h * HALF,
            plan.playerCards.w * (1 + PLAYER_CARD_STEP),
            plan.playerCards.h,
          )
        : parts.holeCards;
    return {
      anchor: plateCentre,
      plate: plateRect,
      avatar: parts.avatar,
      info: parts.info,
      holeCards,
      shownCards: holeCards,
      handName: holeCards,
      shownFallback: false,
      tag: parts.tag,
      betSpot,
      betLabelSide: besidePlate || towardCentre.x < 0 ? 'left' : 'right',
      buttonSpot,
      blindMarker: parts.blindMarker,
      towardCentre,
      bubbleAnchor: { x: plateCentre.x, y: plateRect.y - peek },
      bubbleSide: plateCentre.x <= cx ? 'right' : 'left',
    };
  });

  const clearOfSeats = (parts: ReadonlyArray<Rect>): boolean =>
    seats.every((seat) =>
      [{ ...seat.plate, h: seat.plate.h + tagDrop }, seat.avatar, seat.holeCards].every((part) =>
        parts.every((boardPart) => !overlapsRect(part, boardPart)),
      ),
    );
  const partsOf = (lines: ReturnType<typeof readouts>): Rect[] => [
    boardRow,
    lines.pot,
    lines.sidePots,
    ...lines.piles,
  ];
  const roomy = readouts(false);
  const { pot, sidePots, deck, muck, piles } = clearOfSeats(partsOf(roomy))
    ? roomy
    : readouts(true);
  const boardParts = [boardRow, pot, sidePots, ...piles];
  const boardClear = clearOfSeats(boardParts);
  const placed = placeShownHands(seats, {
    bounds: area,
    // A winning card lifts this far out of its slot, and a name must not be under it.
    obstacles: [...boardParts, { ...boardRow, y: boardRow.y - boardCardH * WIN_LIFT_FRACTION }],
    cardW: boardCardWidth * SHOWN_CARD_FRACTION,
    gap,
    tagDrop,
    labelH: plan.nameH,
    lineH: plan.nameLineH,
    playerCardsOnFelt: plan.playerCards !== null,
  });

  return {
    felt,
    railWidth,
    seats: placed,
    board,
    boardCardWidth,
    pot,
    sidePots,
    potSpot,
    deck,
    muck,
    showPiles: piles.length > 0,
    pileCardWidth,
    chipRadius,
    boardClear,
  };
}

interface ShownHandRoom {
  /** Everything a shown hand must stay inside. */
  readonly bounds: Rect;
  /** What a shown hand must never cover: the board and its readouts, and the piles. */
  readonly obstacles: ReadonlyArray<Rect>;
  readonly cardW: number;
  readonly gap: number;
  readonly tagDrop: number;
  readonly labelH: number;
  /** One line of a shown hand's name, for when two do not fit. */
  readonly lineH: number;
  /** The player's own cards lie on the felt beside their plate, and are left where they are. */
  readonly playerCardsOnFelt: boolean;
}

function overlapsRect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function insideRect(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** One way to lay a shown hand: its cards, its name against them, and how close that keeps it to the plate. */
interface ShownHandSpot {
  readonly cards: Rect;
  readonly name: Rect;
  readonly score: number;
}

function centreOf(r: Rect): Point {
  return { x: r.x + r.w * HALF, y: r.y + r.h * HALF };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return rect(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
}

/** Card widths a shown hand tries, largest first, down to the readable minimum. */
function shownCardWidths(full: number): number[] {
  const widths: number[] = [];
  for (let width = full; width > SHOWN_CARD_MIN_WIDTH; width *= SHOWN_HAND_SHRINK)
    widths.push(width);
  widths.push(SHOWN_CARD_MIN_WIDTH);
  return widths;
}

/** Where a w×h box can sit round a plate: above, below or to either side, at either end or the middle. */
function spotsRoundPlate(seat: PokerSeatLayout, w: number, h: number, gap: number): Rect[] {
  const plate = seat.plate;
  const left = seat.avatar.x;
  const right = plate.x + plate.w;
  const xs = [
    plate.x + plate.w * HALF - w * HALF,
    seat.info.x + seat.info.w * HALF - w * HALF,
    left,
    right - w,
  ];
  const ys = [seat.anchor.y - h * HALF, plate.y, plate.y + plate.h - h];
  return [
    ...xs.map((x) => rect(x, plate.y - gap - h, w, h)),
    ...xs.map((x) => rect(x, plate.y + plate.h + gap, w, h)),
    ...ys.map((y) => rect(right + gap, y, w, h)),
    ...ys.map((y) => rect(left - gap - w, y, w, h)),
  ];
}

/**
 * Where a name can sit against its cards: under, over or to either side,
 * centred on the shared edge or flush with either end of it. A name under or
 * over its cards may slide along them to stay inside `bounds`, as long as it
 * still overlaps them sideways.
 */
function spotsAgainst(cards: Rect, w: number, h: number, gap: number, bounds: Rect): Rect[] {
  const lowest = Math.max(bounds.x, cards.x - w + SIDEWAYS_OVERLAP);
  const highest = Math.min(bounds.x + bounds.w - w, cards.x + cards.w - SIDEWAYS_OVERLAP);
  const slide = (x: number): number => Math.min(Math.max(x, lowest), highest);
  const xs = [
    ...new Set([cards.x + cards.w * HALF - w * HALF, cards.x, cards.x + cards.w - w].map(slide)),
  ];
  const ys = [...new Set([cards.y + cards.h * HALF - h * HALF, cards.y, cards.y + cards.h - h])];
  return [
    ...xs.map((x) => rect(x, cards.y + cards.h + gap, w, h)),
    ...xs.map((x) => rect(x, cards.y - gap - h, w, h)),
    ...ys.map((y) => rect(cards.x + cards.w + gap, y, w, h)),
    ...ys.map((y) => rect(cards.x - gap - w, y, w, h)),
  ];
}

/**
 * Finds each regular a spot for a hand turned up at showdown, and for its
 * name against it. Nothing shown may touch the board, the pot, the piles,
 * anyone's name and stack (its own seat's included), another seat's plate or
 * another shown hand. Among the spots that are clear, the one nearest its own
 * plate wins, with a full two-line name preferred over one line; only when
 * nothing is clear at any size down to the readable minimum do the cards lie
 * over the seat's avatar, with the name on one line against them.
 */
function placeShownHands(
  seats: ReadonlyArray<PokerSeatLayout>,
  room: ShownHandRoom,
): PokerSeatLayout[] {
  const { gap } = room;
  const shownSoFar: Rect[] = [];
  return seats.map((seat, index) => {
    if (index === PLAYER_SEAT_INDEX) {
      return room.playerCardsOnFelt
        ? seat
        : { ...seat, shownCards: seat.holeCards, handName: seat.holeCards };
    }
    const blockers: Rect[] = [...room.obstacles, ...shownSoFar];
    seats.forEach((other, otherIndex) => {
      blockers.push(other.info);
      if (otherIndex === index) {
        blockers.push(other.plate, other.avatar);
        return;
      }
      blockers.push({ ...other.plate, h: other.plate.h + room.tagDrop }, other.avatar);
      if (otherIndex === PLAYER_SEAT_INDEX && room.playerCardsOnFelt)
        blockers.push(other.holeCards);
    });
    const clear = (r: Rect): boolean =>
      insideRect(r, room.bounds) && blockers.every((blocker) => !overlapsRect(r, blocker));
    const home = centreOf(seat.plate);
    // A side seat keeps its hand on its own half of the felt, so the seats
    // across from it still have room and every hand reads as its seat's.
    const feltMiddle = room.bounds.x + room.bounds.w * HALF;
    const onOwnSide = (r: Rect): boolean => {
      if (index === TOP_SEAT_INDEX) return true;
      return home.x < feltMiddle ? r.x + r.w <= feltMiddle : r.x >= feltMiddle;
    };
    for (const cardW of shownCardWidths(room.cardW)) {
      const cardsH = cardW * CARD_ASPECT;
      const cardsW = cardW * (1 + SHOWN_CARD_STEP);
      const nameW = Math.max(cardsW * SHOWN_LABEL_SPANS, SHOWN_LABEL_MIN_WIDTH);
      let best: ShownHandSpot | null = null;
      for (const cards of spotsRoundPlate(seat, cardsW, cardsH, gap).filter(clear)) {
        const shapes = [
          { width: nameW, h: room.labelH, shortfall: 0 },
          {
            width: Math.max(cardsW, SHOWN_LABEL_ONE_LINE_WIDTH),
            h: room.lineH,
            shortfall: ONE_LINE_NAME_PENALTY,
          },
        ];
        for (const { width, h: nameH, shortfall } of shapes) {
          for (const name of spotsAgainst(cards, width, nameH, gap, room.bounds)) {
            if (!clear(name) || !onOwnSide(union(cards, name))) continue;
            const reach = centreOf(union(cards, name));
            const score = Math.hypot(reach.x - home.x, reach.y - home.y) + shortfall;
            if (best === null || score < best.score) best = { cards, name, score };
          }
        }
      }
      if (best !== null) {
        shownSoFar.push(best.cards, best.name);
        return { ...seat, shownCards: best.cards, handName: best.name };
      }
    }
    const avatar = seat.avatar;
    const coverW = avatar.w / (1 + SHOWN_CARD_STEP);
    const coverH = coverW * CARD_ASPECT;
    const cards = rect(avatar.x, avatar.y + avatar.h * HALF - coverH * HALF, avatar.w, coverH);
    const ownPlateOk = (r: Rect): boolean =>
      insideRect(r, room.bounds) &&
      blockers.every(
        (blocker) => blocker === seat.plate || blocker === seat.avatar || !overlapsRect(r, blocker),
      );
    // Pressed up against the cards, so it squeezes into the room a crowded seat has.
    const nameSpots = spotsAgainst(
      cards,
      SHOWN_LABEL_ONE_LINE_WIDTH,
      room.lineH,
      gap * HALF,
      room.bounds,
    );
    const name = nameSpots.find(ownPlateOk) ?? nameSpots[0];
    shownSoFar.push(cards, name);
    return { ...seat, shownCards: cards, handName: name, shownFallback: true };
  });
}

/** How much a cramped felt gives up so its board clears the seats: plate size first, then the player's card size. */
interface FeltSqueeze {
  readonly plate: number;
  readonly playerCards: number;
}

/**
 * Squeezes, gentlest first. A felt whose board would sit on a seat gives up
 * the plates' size first and the player's own cards' last, and those never
 * below a readable size, so the board always has its own band between the
 * seats.
 */
const FELT_SQUEEZES: readonly FeltSqueeze[] = [
  { plate: 1, playerCards: 1 },
  { plate: 0.9, playerCards: 1 },
  { plate: 0.82, playerCards: 1 },
  { plate: 0.82, playerCards: 0.8 },
  { plate: 0.74, playerCards: 0.6 },
];

function firstClearFelt(layOut: (squeeze: FeltSqueeze) => FeltResult): FeltResult {
  let last: FeltResult | null = null;
  for (const squeeze of FELT_SQUEEZES) {
    last = layOut(squeeze);
    if (last.boardClear) return last;
  }
  return last ?? layOut({ plate: 1, playerCards: 1 });
}

/** Shrinks the plates when the felt is too small for them at full size. */
function fittedPlate(metrics: ModeMetrics, area: Rect, growth: number, squeeze: number): PlateSize {
  const w = metrics.plateW * growth;
  const h = metrics.plateH * growth;
  const fit = Math.min(1, area.w / (w * MIN_FELT_W_PER_PLATE), area.h / (h * MIN_FELT_H_PER_PLATE));
  const scale = Math.max(MIN_PLATE_FIT, fit) * squeeze;
  const plateH = h * scale;
  const overhang = metrics.avatarOverhang * growth * scale;
  // However hard the felt squeezes, a plate keeps room for a short name: the
  // name row sits right of the avatar (the plate's height plus its overhang
  // each side) and the gap after it, and short of the plate's end.
  const avatarSide = plateH + overhang * 2;
  const afterAvatar = overhang * 2;
  const shortNameW = SHORT_NAME_INFO_WIDTH + avatarSide + afterAvatar + plateH * BLIND_MARKER_ROOM;
  return { w: Math.max(w * scale, shortNameW), h: plateH, overhang };
}

/**
 * The raise tray takes the action bar's place and the footer's under it, so
 * the player's cards and the "Your hand" line stay in view while they size a
 * raise. It holds three rows when there is room, and folds into two otherwise.
 */
function raiseTrayRect(
  bar: Rect,
  footer: Rect,
  controlH: number,
  gap: number,
): { tray: Rect; rows: number } {
  const tray = rect(bar.x, bar.y, bar.w, footer.y + footer.h - bar.y);
  const threeRows = controlH * TRAY_FULL_ROWS + gap * (TRAY_FULL_ROWS - 1);
  return { tray, rows: tray.h >= threeRows ? TRAY_FULL_ROWS : TRAY_FOLDED_ROWS };
}

function footerLayout(
  row: Rect,
  controlH: number,
  gap: number,
  labelled: boolean,
): PokerFooterLayout {
  if (labelled) {
    const [left, , centre, , right] = splitH(row, ['fill', gap, 'fill', gap, 'fill'], 0);
    const [rules, history] = splitH(left, ['fill', 'fill'], gap);
    const [fast, showCards] = splitH(centre, ['fill', 'fill'], gap);
    return {
      rules,
      history,
      fast,
      showCards,
      leave: { ...right, x: right.x + right.w * HALF, w: right.w * HALF },
      iconsOnly: false,
      leaveIconOnly: false,
    };
  }
  const [rules, history, fast, showCards, leave] = splitH(
    row,
    [controlH, controlH, controlH, controlH, 'fill'],
    gap,
  );
  return {
    rules,
    history,
    fast,
    showCards,
    leave,
    iconsOnly: true,
    leaveIconOnly: leave.w < controlH * LABELLED_LEAVE_MIN_CONTROLS,
  };
}

/** Resolves the whole table for a safe area of `input.width` × `input.height` UI units. */
export function computePokerLayout(input: PokerLayoutInput): PokerLayout {
  const mode = pokerLayoutMode(input.width, input.height);
  const metrics = metricsFor(mode);
  const { theme } = input;
  const { space } = theme;
  const controlH = pokerControlHeight(theme, input.uiScale);
  const labelLineH = theme.type.label.lineHeight;
  const tagH = Math.max(TAG_HEIGHT, theme.type.overline.lineHeight + space.xs);
  const gap = metrics.sectionGap;

  const panelW = Math.min(metrics.maxPanelW, input.width - metrics.margin * 2);
  const panelH = Math.min(metrics.maxPanelH, input.height - metrics.margin * 2);
  const panel = rect((input.width - panelW) * HALF, (input.height - panelH) * HALF, panelW, panelH);
  const inner = inset(panel, metrics.padding);

  if (mode === 'landscape') return landscapeLayout(input, metrics, panel, inner, controlH, tagH);

  const actionRows = mode === 'compact' ? COMPACT_ACTION_ROWS : 1;
  const actionH = controlH * actionRows + space.sm * (actionRows - 1);
  const [headerRow, feltArea, handRow, actionRow, footerRow] = splitV(
    inner,
    [metrics.headerH, 'fill', labelLineH, actionH, controlH],
    gap,
  );
  const reference = mode === 'compact' ? COMPACT_REFERENCE_WIDTH : WIDE_REFERENCE_WIDTH;
  const maxGrowth = mode === 'compact' ? COMPACT_MAX_GROWTH : WIDE_MAX_GROWTH;
  const growth = Math.min(maxGrowth, Math.max(1, inner.w / reference));
  const layOutAt = (squeeze: FeltSqueeze): FeltResult => {
    const plate = fittedPlate(metrics, feltArea, growth, squeeze.plate);
    const playerCardH = Math.max(
      PLAYER_CARD_MIN_WIDTH * CARD_ASPECT,
      Math.min(
        metrics.maxPlayerCardW * growth * CARD_ASPECT,
        feltArea.h * PLAYER_CARD_HEIGHT_SHARE * squeeze.playerCards,
      ),
    );
    return layOutFelt({
      area: feltArea,
      sideRise: metrics.sideRise,
      shownOverPlate: mode === 'compact',
      plate,
      playerCards: { w: playerCardH / CARD_ASPECT, h: playerCardH },
      maxBoardCardW: metrics.maxBoardCardW * growth,
      gap: space.sm,
      tagH,
      nameH: theme.type.caption.lineHeight * HAND_NAME_LINES + space.xs,
      nameLineH: theme.type.caption.lineHeight + space.xs,
    });
  };
  const felt = firstClearFelt(layOutAt);

  const barW = mode === 'wide' ? Math.min(actionRow.w, WIDE_ACTION_BAR_MAX_W) : actionRow.w;
  const actionBar = centerIn(actionRow, barW, actionRow.h);
  const footer = footerLayout(footerRow, controlH, space.sm, footerRow.w >= LABELLED_FOOTER_MIN_W);
  // Where the footer is wider than the action bar the tray narrows to keep
  // clear of Leave. On a phone it covers the whole footer, Leave included, and
  // its own ✕ is the way back.
  const barCentre = actionBar.x + actionBar.w * HALF;
  const clearOfLeave = footer.leave.x - space.sm - space.xs - barCentre;
  const trayBar =
    mode === 'wide' && footer.leave.x > barCentre
      ? centerIn(actionBar, Math.min(actionBar.w, clearOfLeave * 2), actionBar.h)
      : actionBar;
  const { tray, rows: trayRows } = raiseTrayRect(trayBar, footerRow, controlH, space.xs);
  return {
    mode,
    panel,
    header: headerLayout(headerRow, mode, theme),
    ...felt,
    handLabel: handRow,
    actionBar,
    actionRows,
    raiseTray: tray,
    trayRows,
    footer,
    controlHeight: controlH,
  };
}

function headerLayout(row: Rect, mode: PokerLayoutMode, theme: Theme): PokerHeaderLayout {
  const { space, type } = theme;
  const bust = rect(row.x, row.y, row.h, row.h);
  const textX = bust.x + bust.w + space.md;
  if (mode === 'wide') {
    const infoW = Math.min(row.w * HALF * HALF + space.xxl, row.w * HALF);
    const infoX = row.x + row.w - infoW;
    const blockH = type.title.lineHeight + type.caption.lineHeight;
    const blockY = row.y + (row.h - blockH) * HALF;
    return {
      bust,
      banter: rect(textX, row.y, infoX - space.lg - textX, row.h),
      title: rect(infoX, blockY, infoW, type.title.lineHeight),
      info: rect(infoX, blockY + type.title.lineHeight, infoW, type.caption.lineHeight),
    };
  }
  const titleH = type.label.lineHeight;
  return {
    bust,
    title: rect(textX, row.y, row.x + row.w - textX, titleH),
    info: rect(textX, row.y, row.x + row.w - textX, titleH),
    banter: rect(textX, row.y + titleH, row.x + row.w - textX, row.h - titleH),
  };
}

/**
 * The felt on the left with a slim header over it, and the player's own cards,
 * the "Your hand" line, the action bar and the footer stacked in a column on
 * the right, so full-size touch targets never sit on top of the table.
 */
function landscapeLayout(
  input: PokerLayoutInput,
  metrics: ModeMetrics,
  panel: Rect,
  inner: Rect,
  controlH: number,
  tagH: number,
): PokerLayout {
  const { theme } = input;
  const { space } = theme;
  const gap = metrics.sectionGap;
  const footerMinW = controlH * LANDSCAPE_FOOTER_SLOTS + space.xs * (LANDSCAPE_FOOTER_SLOTS - 1);
  const columnW = Math.max(inner.w * LANDSCAPE_COLUMN_SHARE, footerMinW);
  const [feltColumn, controlColumn] = splitH(inner, ['fill', columnW], space.md);
  const feltArea = inset(feltColumn, { t: space.lg, b: space.xs });
  const felt = firstClearFelt((squeeze) =>
    layOutFelt({
      area: feltArea,
      sideRise: metrics.sideRise,
      shownOverPlate: true,
      plate: fittedPlate(metrics, feltArea, 1, squeeze.plate),
      playerCards: null,
      maxBoardCardW: metrics.maxBoardCardW,
      gap: space.xs,
      tagH,
      nameH: theme.type.caption.lineHeight * HAND_NAME_LINES + space.xs,
      nameLineH: theme.type.caption.lineHeight + space.xs,
    }),
  );

  const actionH = controlH * COMPACT_ACTION_ROWS + space.xs;
  const labelH = theme.type.label.lineHeight;
  const fixedH = metrics.headerH + labelH + actionH + controlH + gap * LANDSCAPE_COLUMN_GAPS;
  const cardsH = Math.max(
    0,
    Math.min(metrics.maxPlayerCardW * CARD_ASPECT, controlColumn.h - fixedH),
  );
  const [headerRow, cardsRow, handRow, , actionBar, footerRow] = splitV(
    controlColumn,
    [metrics.headerH, cardsH, labelH, 'fill', actionH, controlH],
    gap,
  );
  const cardW = cardsH / CARD_ASPECT;
  const cardsSpan = cardW * (1 + PLAYER_CARD_STEP);
  const playerCards = centerIn(cardsRow, cardsSpan, cardsH);
  const seats = felt.seats.map((seat, index) =>
    index === PLAYER_SEAT_INDEX
      ? { ...seat, holeCards: playerCards, shownCards: playerCards, handName: playerCards }
      : seat,
  );
  const { tray, rows: trayRows } = raiseTrayRect(actionBar, footerRow, controlH, space.xs);
  return {
    mode: 'landscape',
    panel,
    header: headerLayout(headerRow, 'landscape', theme),
    ...felt,
    seats,
    handLabel: handRow,
    actionBar,
    actionRows: COMPACT_ACTION_ROWS,
    raiseTray: tray,
    trayRows,
    footer: footerLayout(footerRow, controlH, space.xs, false),
    controlHeight: controlH,
  };
}
