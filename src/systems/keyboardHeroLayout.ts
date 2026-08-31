/**
 * A pure viewport → layout function for the keyboard-hero board, mirroring
 * `src/ui/casino/casinoLayout.ts`. No drawing, no canvas, no globals — hand it a
 * viewport and it resolves every rect the mini-game needs.
 *
 * Two coordinate spaces meet here:
 *
 * - **Note space** is the one `keyboardHeroGeometry.ts` and the baked chart are
 *   written in: a note enters at `NOTE_SPAWN_IMG_Y` and is perfectly struck when
 *   its centre reaches `HIT_ZONE_IMG_CENTER`. Those numbers are frozen — the
 *   chart's timings only mean anything against them.
 * - **Board space** is this module's own design space for the art: the console
 *   housing, its header and footer strips, and the four lane beds. The lane bed
 *   *is* note space vertically, so one uniform scale maps both to the screen.
 *
 * Because the lane bed runs `LANE_BED_IMG_H` deep while the hit line sits at
 * `HIT_ZONE_IMG_CENTER`, there is real board below the receptors — enough for a
 * note to stay visible for the whole back half of its hit window instead of
 * disappearing off the bottom edge the moment it is late.
 */

import {
  HIT_ZONE_IMG_CENTER,
  HIT_WINDOW_MS,
  FALL_SPEED_IMG_PX_PER_MS,
} from './keyboardHeroGeometry';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const LANE_COUNT = 4;

/** Lane index, matching `KeyboardHeroColumn` and the movement action it binds to. */
export type LaneIndex = 0 | 1 | 2 | 3;

export const LANE_LEFT = 0;
export const LANE_UP = 1;
export const LANE_DOWN = 2;
export const LANE_RIGHT = 3;

export const LANE_INDICES: readonly LaneIndex[] = [LANE_LEFT, LANE_UP, LANE_DOWN, LANE_RIGHT];

/**
 * One fixed hue per lane — guitar hero's oldest readability trick, and the thing
 * that lets a player tell at a glance which falling note belongs to which key.
 *
 * The four are the Okabe-Ito colourblind-safe qualitative set, brightened for a
 * neon console: no two of them collapse together under deuteranopia,
 * protanopia or tritanopia, and they differ in luminance as well as hue so the
 * separation survives even in greyscale.
 */
export interface LanePalette {
  /** The lane's identity colour: note face, receptor ring, particles, glow. */
  readonly hue: string;
  /** A darker shade for bevel shadow and the lane bed's tint. */
  readonly shade: string;
  /** A lighter shade for the keycap's lit top bevel and flash states. */
  readonly light: string;
  /** Human-readable name, used by the review harness's captions. */
  readonly name: string;
  /** The arrow the lane's keycap carries. */
  readonly glyph: 'left' | 'up' | 'down' | 'right';
}

export const LANE_PALETTES: readonly [LanePalette, LanePalette, LanePalette, LanePalette] = [
  { hue: '#4fc3f7', shade: '#12475f', light: '#b6e7ff', name: 'sky', glyph: 'left' },
  { hue: '#ffa726', shade: '#6b3d05', light: '#ffe0ab', name: 'amber', glyph: 'up' },
  { hue: '#34d399', shade: '#0c4a3a', light: '#b4f5db', name: 'jade', glyph: 'down' },
  { hue: '#e879c0', shade: '#5c1c47', light: '#ffcdeb', name: 'orchid', glyph: 'right' },
];

// ── Board design space ──────────────────────────────────────────────────────
// Every dimension below is in board-space pixels. The bakery paints at
// `BOARD_BAKE_SCALE` times these; the runtime scales them to the viewport.

/** Width of one lane bed. Sized so a keycap reads as a key, not a stripe. */
export const LANE_BED_IMG_W = 112;

/**
 * Depth of the visible lane bed, in note-space pixels. Deliberately deeper than
 * `HIT_ZONE_IMG_CENTER`: the leftover is the apron below the receptors, and it
 * is sized to cover the late half of the hit window so a note the player is
 * still allowed to strike is still on the board.
 */
export const LANE_BED_IMG_H = 700;

/** Gap between neighbouring lane beds, where the frame's divider rail shows through. */
export const LANE_GAP_IMG = 6;

/** Width of the console housing's side rail — the cabling and vent column. */
export const FRAME_RAIL_IMG_W = 26;

/** Header strip: firewall pips, song progress bar, remaining time. */
export const FRAME_HEADER_IMG_H = 54;

/** Footer strip: hit count, streak, and the key/tap hint. */
export const FRAME_FOOTER_IMG_H = 46;

export const LANE_AREA_IMG_W = LANE_COUNT * LANE_BED_IMG_W + (LANE_COUNT - 1) * LANE_GAP_IMG;
export const BOARD_IMG_W = LANE_AREA_IMG_W + FRAME_RAIL_IMG_W * 2;
export const BOARD_IMG_H = LANE_BED_IMG_H + FRAME_HEADER_IMG_H + FRAME_FOOTER_IMG_H;

/** Side of the square note keycap, in board space. */
export const NOTE_IMG_SIZE = 96;

/** Side of the square receptor. Larger than a note so a note lands *inside* it. */
export const RECEPTOR_IMG_SIZE = 108;

/** Side of one firewall integrity pip, in board space. */
export const INTEGRITY_PIP_IMG_SIZE = 20;

/** Side of a mobile touch button, in board space. */
export const TOUCH_IMG_SIZE = 96;

/** Every baked sheet is painted at this multiple of board space, like the rest of the art. */
export const BOARD_BAKE_SCALE = 2;

/** Half the hit window expressed as note-space pixels — the band around the hit line. */
export const HIT_WINDOW_IMG_HALF_HEIGHT = HIT_WINDOW_MS * FALL_SPEED_IMG_PX_PER_MS;

// ── Fit ─────────────────────────────────────────────────────────────────────

/** Fraction of the viewport's height the board may occupy on a desktop screen. */
const DESKTOP_HEIGHT_RATIO = 0.9;

/** Mobile leaves a band under the board for the touch buttons. */
const MOBILE_HEIGHT_RATIO = 0.7;

const BOARD_WIDTH_RATIO = 0.94;

/** A touch target must be at least this many screen pixels on its short side. */
export const MIN_TOUCH_TARGET_PX = 48;

/** Screen-space gap kept between the board's bottom edge and the touch row. */
const TOUCH_ROW_GAP_PX = 10;

/** Screen-space breathing room kept below the touch row. */
const TOUCH_ROW_BOTTOM_MARGIN_PX = 12;

/** Fraction of the header strip's width given to the progress bar. */
const PROGRESS_BAR_WIDTH_FRACTION = 0.46;

/** Board-space height of the progress bar. */
const PROGRESS_BAR_IMG_H = 12;

/** Board-space inset keeping header and footer content off the side rails. */
const STRIP_INSET_IMG = 10;

export interface KeyboardHeroLayout {
  /** Board space → screen space multiplier. */
  readonly scale: number;
  readonly isMobile: boolean;
  /** The whole console housing, the rect the baked frame is drawn into. */
  readonly board: Rect;
  /** The four lane beds together, excluding the rails, header and footer. */
  readonly laneArea: Rect;
  /** Interior play columns — the only rects a tap may be attributed to. */
  readonly lanes: LaneRects;
  /** Screen Y at which a note is perfectly struck. */
  readonly hitLineY: number;
  /** Screen height of half the hit window, for drawing the window band. */
  readonly hitWindowHalfHeight: number;
  readonly receptors: LaneRects;
  /** Side of a note keycap on screen. */
  readonly noteSize: number;
  readonly header: Rect;
  readonly footer: Rect;
  readonly progressBar: Rect;
  /** Right-aligned anchor for the MM:SS readout. */
  readonly timerAnchor: Point;
  /** Left-aligned anchor for the firewall integrity pips. */
  readonly integrityAnchor: Point;
  /** Screen side of one integrity pip. */
  readonly integrityPipSize: number;
  /** Left-aligned anchor for the hit counter. */
  readonly hitCountAnchor: Point;
  /** Right-aligned anchor for the streak counter. */
  readonly streakAnchor: Point;
  /** Centre anchor for the key/tap hint line. */
  readonly hintAnchor: Point;
  /** Centre of the board, where the countdown and the success stamp land. */
  readonly boardCenter: Point;
  /** Null on desktop, where the keyboard is the control surface. */
  readonly touchButtons: LaneRects | null;
}

type LaneRects = readonly [Rect, Rect, Rect, Rect];

/**
 * `map` over the lane indices widens to a plain array, which loses the
 * four-element shape every consumer indexes by `LaneIndex`. Building the tuple
 * from a per-lane function keeps that shape without a runtime check.
 */
function perLane(build: (lane: LaneIndex) => Rect): LaneRects {
  return [build(LANE_LEFT), build(LANE_UP), build(LANE_DOWN), build(LANE_RIGHT)];
}

function laneRects(
  laneAreaX: number,
  laneAreaY: number,
  laneAreaH: number,
  scale: number,
): LaneRects {
  const laneW = LANE_BED_IMG_W * scale;
  const strideX = (LANE_BED_IMG_W + LANE_GAP_IMG) * scale;
  return perLane((lane) => ({
    x: laneAreaX + lane * strideX,
    y: laneAreaY,
    width: laneW,
    height: laneAreaH,
  }));
}

export function computeKeyboardHeroLayout(
  viewportW: number,
  viewportH: number,
  isMobile: boolean,
): KeyboardHeroLayout {
  const heightRatio = isMobile ? MOBILE_HEIGHT_RATIO : DESKTOP_HEIGHT_RATIO;
  const scale = Math.min(
    (viewportH * heightRatio) / BOARD_IMG_H,
    (viewportW * BOARD_WIDTH_RATIO) / BOARD_IMG_W,
  );

  const boardW = BOARD_IMG_W * scale;
  const boardH = BOARD_IMG_H * scale;
  const boardX = (viewportW - boardW) / 2;

  const touchSize = isMobile ? Math.max(MIN_TOUCH_TARGET_PX, TOUCH_IMG_SIZE * scale) : 0;
  const touchBandH = isMobile ? touchSize + TOUCH_ROW_GAP_PX + TOUCH_ROW_BOTTOM_MARGIN_PX : 0;
  const boardY = Math.max(0, (viewportH - boardH - touchBandH) / 2);

  const laneAreaX = boardX + FRAME_RAIL_IMG_W * scale;
  const laneAreaY = boardY + FRAME_HEADER_IMG_H * scale;
  const laneAreaW = LANE_AREA_IMG_W * scale;
  const laneAreaH = LANE_BED_IMG_H * scale;
  const lanes = laneRects(laneAreaX, laneAreaY, laneAreaH, scale);

  const hitLineY = laneAreaY + HIT_ZONE_IMG_CENTER * scale;
  const receptorSize = RECEPTOR_IMG_SIZE * scale;
  const receptors = perLane((lane) => ({
    x: lanes[lane].x + (lanes[lane].width - receptorSize) / 2,
    y: hitLineY - receptorSize / 2,
    width: receptorSize,
    height: receptorSize,
  }));

  const stripInset = STRIP_INSET_IMG * scale;
  const header: Rect = {
    x: laneAreaX,
    y: boardY,
    width: laneAreaW,
    height: FRAME_HEADER_IMG_H * scale,
  };
  const footer: Rect = {
    x: laneAreaX,
    y: laneAreaY + laneAreaH,
    width: laneAreaW,
    height: FRAME_FOOTER_IMG_H * scale,
  };

  const progressW = header.width * PROGRESS_BAR_WIDTH_FRACTION;
  const progressH = PROGRESS_BAR_IMG_H * scale;
  const progressBar: Rect = {
    x: header.x + (header.width - progressW) / 2,
    y: header.y + (header.height - progressH) / 2,
    width: progressW,
    height: progressH,
  };

  let touchButtons: LaneRects | null = null;
  if (isMobile) {
    const rowY = Math.min(
      boardY + boardH + TOUCH_ROW_GAP_PX,
      viewportH - touchSize - TOUCH_ROW_BOTTOM_MARGIN_PX,
    );
    touchButtons = perLane((lane) => ({
      x: lanes[lane].x + (lanes[lane].width - touchSize) / 2,
      y: rowY,
      width: touchSize,
      height: touchSize,
    }));
  }

  return {
    scale,
    isMobile,
    board: { x: boardX, y: boardY, width: boardW, height: boardH },
    laneArea: { x: laneAreaX, y: laneAreaY, width: laneAreaW, height: laneAreaH },
    lanes,
    hitLineY,
    hitWindowHalfHeight: HIT_WINDOW_IMG_HALF_HEIGHT * scale,
    receptors,
    noteSize: NOTE_IMG_SIZE * scale,
    header,
    footer,
    progressBar,
    timerAnchor: { x: header.x + header.width - stripInset, y: header.y + header.height / 2 },
    integrityAnchor: { x: header.x + stripInset, y: header.y + header.height / 2 },
    integrityPipSize: INTEGRITY_PIP_IMG_SIZE * scale,
    hitCountAnchor: { x: footer.x + stripInset, y: footer.y + footer.height / 2 },
    streakAnchor: { x: footer.x + footer.width - stripInset, y: footer.y + footer.height / 2 },
    hintAnchor: { x: footer.x + footer.width / 2, y: footer.y + footer.height / 2 },
    boardCenter: { x: boardX + boardW / 2, y: laneAreaY + laneAreaH / 2 },
    touchButtons,
  };
}

/** Screen Y of a note-space Y under this layout. */
export function noteImgYToScreenY(layout: KeyboardHeroLayout, imgY: number): number {
  return layout.laneArea.y + imgY * layout.scale;
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * The lane a tap belongs to, or null if it landed on the frame, the rails or
 * outside the board entirely. Taps are attributed to the lane beds and the touch
 * buttons only — never to the whole board rect, which would make a tap on the
 * decorative left rail read as a press of the leftmost lane.
 */
export function laneAtPoint(layout: KeyboardHeroLayout, x: number, y: number): LaneIndex | null {
  for (const lane of LANE_INDICES) {
    if (containsPoint(layout.lanes[lane], x, y)) return lane;
  }
  const buttons = layout.touchButtons;
  if (buttons !== null) {
    for (const lane of LANE_INDICES) {
      if (containsPoint(buttons[lane], x, y)) return lane;
    }
  }
  return null;
}
