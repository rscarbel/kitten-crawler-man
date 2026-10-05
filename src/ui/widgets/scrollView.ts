/**
 * A clipped, scrollable column: wheel, touch/mouse drag anywhere on it (rows
 * inside still tap), and a thin scrollbar whose thumb can be dragged. The
 * offset lives in `uiState`, so a reopened menu starts at the top.
 */

import { contains, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { withAlpha } from '../theme/color';
import { fillRounded } from './paint';

export interface ScrollViewOptions {
  readonly id: string;
  /** Total height of what `draw` lays out. */
  readonly contentHeight: number;
  /**
   * Draws the content into `content`: full height, already offset by the
   * scroll and narrowed to leave room for the scrollbar. Everything drawn and
   * registered here is clipped to the view.
   */
  readonly draw: (content: Rect) => void;
}

export interface ScrollViewResult {
  readonly offset: number;
  readonly maxOffset: number;
  /** The visible window, in the same coordinates as the content. */
  readonly visible: Rect;
}

interface ScrollState {
  offset: number;
  dragFrom: number;
}

const SCROLL = new UiStateSlot<ScrollState>('scroll', () => ({ offset: 0, dragFrom: 0 }));

/** Width of the scrollbar's thumb at rest and while hovered or dragged. */
const SCROLLBAR_WIDTH = 4;
const SCROLLBAR_ACTIVE_WIDTH = 6;
/** Shortest the thumb gets, so a very long list keeps something to grab. */
const MIN_THUMB_LENGTH = 24;
const THUMB_ALPHA = 0.28;
const THUMB_ACTIVE_ALPHA = 0.5;
/**
 * Content measured to fit a view can come back a hair taller from float
 * rounding in the layout sums; that much overflow is not worth a scrollbar.
 */
const OVERFLOW_TOLERANCE = 0.5;

function clampOffset(offset: number, maxOffset: number): number {
  return Math.min(maxOffset, Math.max(0, offset));
}

/** Scrolls `id` so the band from `top` to `bottom` (content coordinates from its top) is in view. */
export function scrollIntoView(
  ui: Ui,
  id: string,
  top: number,
  bottom: number,
  viewHeight: number,
): void {
  const state = ui.state(SCROLL, id);
  if (top < state.offset) state.offset = top;
  else if (bottom > state.offset + viewHeight) state.offset = bottom - viewHeight;
}

/** How much narrower a scroll view's content is than the view once it scrolls (room for the scrollbar). */
export function scrollGutterWidth(ui: Ui): number {
  return ui.theme.space.sm + SCROLLBAR_ACTIVE_WIDTH;
}

export function scrollView(ui: Ui, rect: Rect, opts: ScrollViewOptions): ScrollViewResult {
  const state = ui.state(SCROLL, opts.id);
  const overflow = opts.contentHeight - rect.h;
  const maxOffset = overflow > OVERFLOW_TOLERANCE ? overflow : 0;
  state.offset = clampOffset(state.offset, maxOffset);
  const scrollable = maxOffset > 0;
  const { space } = ui.theme;

  ui.hit(`${opts.id}/view`, rect, {
    focusable: false,
    onWheel: scrollable
      ? (dy) => {
          state.offset = clampOffset(state.offset + dy, maxOffset);
        }
      : undefined,
    onDrag: scrollable
      ? {
          onStart: () => {
            state.dragFrom = state.offset;
          },
          onMove: (point) => {
            state.offset = clampOffset(state.dragFrom - point.dy, maxOffset);
          },
        }
      : undefined,
  });

  const gutter = scrollable ? scrollGutterWidth(ui) : 0;
  ui.clip(rect, () => {
    opts.draw({ x: rect.x, y: rect.y - state.offset, w: rect.w - gutter, h: opts.contentHeight });
  });

  if (scrollable) {
    const trackH = rect.h - space.xs * 2;
    const thumbH = Math.max(MIN_THUMB_LENGTH, (trackH * rect.h) / opts.contentHeight);
    const travel = trackH - thumbH;
    const thumbY = rect.y + space.xs + (travel * state.offset) / maxOffset;
    const grab: Rect = {
      x: rect.x + rect.w - gutter + space.xs,
      y: thumbY,
      w: gutter - space.xs,
      h: thumbH,
    };
    const thumbState = ui.hit(`${opts.id}/thumb`, grab, {
      focusable: false,
      sound: null,
      onDrag: {
        onStart: () => {
          state.dragFrom = state.offset;
        },
        onMove: (point) => {
          const perUnit = travel > 0 ? maxOffset / travel : 0;
          state.offset = clampOffset(state.dragFrom + point.dy * perUnit, maxOffset);
        },
      },
    });
    const pointer = ui.pointer;
    const overView = pointer !== null && contains(rect, pointer.x, pointer.y);
    const active = thumbState.hovered || thumbState.pressed;
    const width = ui.tween(`${opts.id}/thumbW`, active ? SCROLLBAR_ACTIVE_WIDTH : SCROLLBAR_WIDTH, {
      ms: ui.theme.motion.fast,
    });
    const alpha = active || overView ? THUMB_ACTIVE_ALPHA : THUMB_ALPHA;
    fillRounded(
      ui.ctx,
      { x: rect.x + rect.w - space.xxs - width, y: thumbY, w: width, h: thumbH },
      ui.theme.radius.pill,
      withAlpha(ui.theme.palette.text.primary, alpha),
    );
  }

  return {
    offset: state.offset,
    maxOffset,
    visible: { x: rect.x, y: state.offset, w: rect.w, h: rect.h },
  };
}
