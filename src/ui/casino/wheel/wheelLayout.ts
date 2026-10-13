/**
 * Where everything on the wheel screen sits, in UI units relative to the safe
 * area's top left. Three shapes, chosen from the viewport like the card tables':
 *
 * - **compact** (a phone held upright): a header strip, then Tito's bust as a
 *   header bust beside his speech, the wheel across the full width, and the bet
 *   and SPIN rows under it.
 * - **landscape** (a phone on its side) and **wide** (a desktop): the wheel on
 *   the left at full height, Tito's bust beside it on the right with his
 *   speech, the bet and SPIN under him.
 *
 * Every control is at least {@link MIN_TOUCH_TARGET_PX} tall in screen pixels.
 */

import { MIN_TOUCH_TARGET_PX } from '../casinoLayout';
import type { Rect } from '../../core/geom';
import type { Theme } from '../../theme/tokens';

export type WheelLayoutMode = 'wide' | 'compact' | 'landscape';

export interface WheelDisc {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface WheelLayout {
  readonly mode: WheelLayoutMode;
  readonly title: Rect;
  readonly purse: Rect;
  readonly leave: Rect;
  readonly wheel: WheelDisc;
  /** Tito's bust: a square. */
  readonly bust: Rect;
  readonly speech: Rect;
  readonly betDown: Rect;
  readonly betValue: Rect;
  readonly betUp: Rect;
  readonly spin: Rect;
  /** The landing banner, laid across the wheel's lower half. */
  readonly banner: Rect;
  readonly controlHeight: number;
}

export interface WheelLayoutInput {
  readonly width: number;
  readonly height: number;
  /** CSS pixels per UI unit, for the touch minimum. */
  readonly uiScale: number;
  readonly theme: Theme;
}

/** A screen at least this much taller than wide is a phone held upright. */
const PORTRAIT_MIN_ASPECT = 1.15;
/** Below this height the wheel and the controls go side by side at phone scale. */
const STACKED_MIN_HEIGHT = 520;
/** Below this width a not-quite-portrait screen still takes the phone layout. */
const WIDE_MIN_WIDTH = 640;

export function wheelLayoutMode(width: number, height: number): WheelLayoutMode {
  if (height >= width * PORTRAIT_MIN_ASPECT) return 'compact';
  if (height < STACKED_MIN_HEIGHT) return 'landscape';
  if (width < WIDE_MIN_WIDTH) return 'compact';
  return 'wide';
}

/** The control height that is a touch target in screen pixels at `uiScale`. */
export function wheelControlHeight(theme: Theme, uiScale: number): number {
  return Math.max(theme.size.control, MIN_TOUCH_TARGET_PX / Math.max(uiScale, Number.EPSILON));
}

/** SPIN stands taller than the bet row, so the hold meter reads at a glance. */
const SPIN_HEIGHT_FACTOR = 1.5;
/** The phone's header bust, as a share of the screen width, and its ceiling. */
const COMPACT_BUST_WIDTH_SHARE = 0.24;
const COMPACT_BUST_MAX = 104;
/** The right-hand column beside the wheel, as a share of the width, and its bounds. */
const SIDE_COLUMN_SHARE = 0.36;
const SIDE_COLUMN_MIN = 210;
const SIDE_COLUMN_MAX = 380;
/** Tito's bust in the side column, as a share of that column's height, and its ceiling. */
const SIDE_BUST_HEIGHT_SHARE = 0.5;
/** A phone on its side gives Tito less of the column, so his patter keeps two lines. */
const LANDSCAPE_BUST_HEIGHT_SHARE = 0.3;
const SIDE_BUST_MAX = 320;
/** The bet readout between the two steppers, as a share of the bet row. */
const BET_VALUE_SHARE = 0.5;
/** SPIN's widest, so a desktop button stays a button. */
const SPIN_MAX_WIDTH = 360;
/** The speech bubble's shortest, two lines of patter. */
const SPEECH_MIN_HEIGHT = 48;
/** The banner's height as a share of the wheel's radius, and how far below the hub it sits. */
const BANNER_HEIGHT_SHARE = 0.5;
/** The banner's tallest, so a desktop banner stays a banner rather than a billboard. */
const BANNER_MAX_HEIGHT = 150;
const BANNER_DROP_SHARE = 0.22;
/** The banner overhangs the wheel a little on a phone, where the wheel is the whole width. */
const BANNER_WIDTH_SHARE = 1.9;
/** Room kept above the wheel for the pointer, as a share of the radius. */
const POINTER_ROOM_SHARE = 0.16;
const HEADER_LEAVE_WIDTH_FACTOR = 2.2;
const HEADER_PURSE_WIDTH_FACTOR = 3.4;
const HALF = 0.5;

function rowOfThree(row: Rect, valueShare: number, gap: number): [Rect, Rect, Rect] {
  const valueW = row.w * valueShare;
  const sideW = (row.w - valueW - gap * 2) / 2;
  return [
    { x: row.x, y: row.y, w: sideW, h: row.h },
    { x: row.x + sideW + gap, y: row.y, w: valueW, h: row.h },
    { x: row.x + sideW + gap * 2 + valueW, y: row.y, w: sideW, h: row.h },
  ];
}

function banner(wheel: WheelDisc, maxWidth: number): Rect {
  const w = Math.min(maxWidth, wheel.radius * BANNER_WIDTH_SHARE);
  const h = Math.min(BANNER_MAX_HEIGHT, wheel.radius * BANNER_HEIGHT_SHARE);
  return {
    x: wheel.cx - w * HALF,
    y: wheel.cy + wheel.radius * BANNER_DROP_SHARE,
    w,
    h,
  };
}

export function computeWheelLayout(input: WheelLayoutInput): WheelLayout {
  const { width, height, theme } = input;
  const mode = wheelLayoutMode(width, height);
  const gap = theme.space.sm;
  const margin = mode === 'wide' ? theme.space.xl : theme.space.md;
  const controlHeight = wheelControlHeight(theme, input.uiScale);
  const spinHeight = controlHeight * SPIN_HEIGHT_FACTOR;

  const headerY = margin;
  const leaveW = controlHeight * HEADER_LEAVE_WIDTH_FACTOR;
  const leave: Rect = { x: width - margin - leaveW, y: headerY, w: leaveW, h: controlHeight };
  const purseW = controlHeight * HEADER_PURSE_WIDTH_FACTOR;
  const purse: Rect = { x: leave.x - gap - purseW, y: headerY, w: purseW, h: controlHeight };
  const title: Rect = {
    x: margin,
    y: headerY,
    w: Math.max(0, purse.x - gap - margin),
    h: controlHeight,
  };
  const bodyTop = headerY + controlHeight + gap;
  const bodyBottom = height - margin;

  if (mode === 'compact') {
    const innerW = width - margin * 2;
    const bustSize = Math.min(COMPACT_BUST_MAX, width * COMPACT_BUST_WIDTH_SHARE);
    const bust: Rect = { x: margin, y: bodyTop, w: bustSize, h: bustSize };
    const speech: Rect = {
      x: bust.x + bustSize + gap,
      y: bodyTop,
      w: Math.max(0, innerW - bustSize - gap),
      h: Math.max(SPEECH_MIN_HEIGHT, bustSize),
    };
    const spinW = Math.min(SPIN_MAX_WIDTH, innerW);
    const spin: Rect = {
      x: (width - spinW) * HALF,
      y: bodyBottom - spinHeight,
      w: spinW,
      h: spinHeight,
    };
    const betRow: Rect = {
      x: spin.x,
      y: spin.y - gap - controlHeight,
      w: spinW,
      h: controlHeight,
    };
    const [betDown, betValue, betUp] = rowOfThree(betRow, BET_VALUE_SHARE, gap);
    const wheelTop = bust.y + Math.max(bust.h, speech.h) + gap;
    const wheelRoomH = betRow.y - gap - wheelTop;
    const radius = Math.max(0, Math.min(innerW, wheelRoomH / (1 + POINTER_ROOM_SHARE)) * HALF);
    const wheel: WheelDisc = {
      cx: width * HALF,
      cy: wheelTop + wheelRoomH * HALF + radius * POINTER_ROOM_SHARE * HALF,
      radius,
    };
    return {
      mode,
      title,
      purse,
      leave,
      wheel,
      bust,
      speech,
      betDown,
      betValue,
      betUp,
      spin,
      banner: banner(wheel, innerW),
      controlHeight,
    };
  }

  const columnW = Math.min(SIDE_COLUMN_MAX, Math.max(SIDE_COLUMN_MIN, width * SIDE_COLUMN_SHARE));
  const column: Rect = {
    x: width - margin - columnW,
    y: bodyTop,
    w: columnW,
    h: Math.max(0, bodyBottom - bodyTop),
  };
  const spin: Rect = {
    x: column.x,
    y: bodyBottom - spinHeight,
    w: column.w,
    h: spinHeight,
  };
  const betRow: Rect = {
    x: column.x,
    y: spin.y - gap - controlHeight,
    w: column.w,
    h: controlHeight,
  };
  const [betDown, betValue, betUp] = rowOfThree(betRow, BET_VALUE_SHARE, gap);
  const bustRoom = betRow.y - gap - column.y - SPEECH_MIN_HEIGHT - gap;
  const bustSize = Math.max(
    0,
    Math.min(
      SIDE_BUST_MAX,
      column.w,
      column.h * (mode === 'landscape' ? LANDSCAPE_BUST_HEIGHT_SHARE : SIDE_BUST_HEIGHT_SHARE),
      bustRoom,
    ),
  );
  const bust: Rect = {
    x: column.x + (column.w - bustSize) * HALF,
    y: column.y,
    w: bustSize,
    h: bustSize,
  };
  const speech: Rect = {
    x: column.x,
    y: bust.y + bustSize + gap,
    w: column.w,
    h: Math.max(0, betRow.y - gap - (bust.y + bustSize + gap)),
  };
  const wheelArea: Rect = {
    x: margin,
    y: bodyTop,
    w: Math.max(0, column.x - gap - margin),
    h: Math.max(0, bodyBottom - bodyTop),
  };
  const radius = Math.max(0, Math.min(wheelArea.w, wheelArea.h / (1 + POINTER_ROOM_SHARE)) * HALF);
  const wheel: WheelDisc = {
    cx: wheelArea.x + wheelArea.w * HALF,
    cy: wheelArea.y + wheelArea.h * HALF + radius * POINTER_ROOM_SHARE * HALF,
    radius,
  };
  return {
    mode,
    title,
    purse,
    leave,
    wheel,
    bust,
    speech,
    betDown,
    betValue,
    betUp,
    spin,
    banner: banner(wheel, wheelArea.w),
    controlHeight,
  };
}
