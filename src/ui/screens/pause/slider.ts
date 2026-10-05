/**
 * A labelled 0–100% slider: tap or drag along it with a pointer, or focus it
 * and press Left/Right.
 */

import { centerIn, inset, splitV, type Rect } from '../../core/geom';
import type { HitState, Ui } from '../../core/UiRoot';
import { drawFocusRing, fillRounded, hoverAmount } from '../../widgets/paint';
import { lineHeightOf, text } from '../../widgets/text';

export interface SliderOptions {
  readonly id: string;
  readonly label: string;
  /** 0 to 1. */
  readonly value: number;
  readonly onChange: (value: number) => void;
}

const TRACK_HEIGHT = 6;
const THUMB_DIAMETER = 14;
const PERCENT = 100;
/** One Left/Right press moves the value this far. */
export const SLIDER_KEY_STEP = 0.1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The height a slider row takes: its label line, a gap and room for the thumb. */
export function sliderHeight(ui: Ui): number {
  return lineHeightOf(ui, 'label') + ui.theme.space.xs + THUMB_DIAMETER;
}

/** Nudges `value` one key step in `direction`, snapped to whole steps. */
export function stepSlider(value: number, direction: -1 | 1): number {
  const steps = Math.round(value / SLIDER_KEY_STEP) + direction;
  return clamp01(steps * SLIDER_KEY_STEP);
}

export function slider(ui: Ui, rect: Rect, opts: SliderOptions): HitState {
  const { palette, space, radius } = ui.theme;
  const [labelRow, trackRow] = splitV(rect, [lineHeightOf(ui, 'label'), 'fill'], space.xs);
  const track = inset(centerIn(trackRow, trackRow.w, TRACK_HEIGHT), {
    l: THUMB_DIAMETER / 2,
    r: THUMB_DIAMETER / 2,
  });
  const valueAt = (x: number): number => clamp01((x - track.x) / Math.max(1, track.w));
  const state = ui.hit(opts.id, rect, {
    // A keyboard press lands on the centre, which would jump the value to half.
    onTap: (e) => {
      if (e.source !== 'keyboard') opts.onChange(valueAt(e.x));
    },
    onDrag: { onMove: (point) => opts.onChange(valueAt(point.x)) },
    sound: null,
  });
  const value = clamp01(opts.value);
  const hover = hoverAmount(ui, opts.id, state.hovered || state.pressed);

  text(ui, labelRow, { text: opts.label, role: 'labelMuted' });
  text(ui, labelRow, {
    text: `${Math.round(value * PERCENT)}%`,
    role: 'label',
    align: 'right',
    tabular: true,
  });

  fillRounded(ui.ctx, track, radius.pill, palette.meter.track);
  fillRounded(ui.ctx, { ...track, w: track.w * value }, radius.pill, palette.accent.base);
  const thumbSide = THUMB_DIAMETER + hover * space.xxs;
  const thumb = centerIn(
    { x: track.x + track.w * value - thumbSide / 2, y: trackRow.y, w: thumbSide, h: trackRow.h },
    thumbSide,
    thumbSide,
  );
  fillRounded(ui.ctx, thumb, radius.pill, palette.text.primary);
  if (state.focused) drawFocusRing(ui, rect, radius.sm);
  return state;
}
