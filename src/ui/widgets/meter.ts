/**
 * A fill bar: HP, mana, XP, progress. The fill eases to its new value; value
 * that was lost leaves a pale ghost segment that drains away more slowly.
 */

import { inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { skinsFor, type MeterKind } from '../theme/skins';
import { fillRounded } from './paint';
import { text, tabularNumber } from './text';

export interface MeterOptions {
  readonly id: string;
  readonly value: number;
  readonly max: number;
  readonly kind?: MeterKind;
  /** Below this fraction the meter switches to its low colour. */
  readonly lowBelow?: number;
  /** Drawn inside the bar on the left when the bar is tall enough for text. */
  readonly label?: string;
  /** `true` draws `value/max` on the right; a string draws itself. */
  readonly valueText?: boolean | string;
  /** Leave a ghost segment where value was lost. Defaults to true. */
  readonly ghost?: boolean;
}

interface GhostState {
  /** Where the ghost drains from, and when it starts draining. */
  from: number;
  drainAt: number;
  last: number;
}

const GHOST = new UiStateSlot<GhostState | null>('meterGhost', () => null);

/**
 * The ghost holds where the value was for `motion.slow`, so the loss reads
 * as a chunk, then drains to the new value over `motion.slow`.
 */
function ghostLevel(ui: Ui, id: string, fraction: number): number {
  const { slow } = ui.theme.motion;
  const state = ui.state(GHOST, id);
  if (state === null) {
    ui.setState(GHOST, id, { from: fraction, drainAt: ui.now, last: fraction });
    return fraction;
  }
  const current = ghostAt(state, ui.now, slow);
  if (fraction < state.last) {
    state.from = Math.max(current, state.last);
    state.drainAt = ui.now + slow;
  } else if (fraction > state.last) {
    state.from = fraction;
  }
  state.last = fraction;
  return Math.max(fraction, ghostAt(state, ui.now, slow));
}

function ghostAt(state: GhostState, now: number, drainMs: number): number {
  const progress = Math.min(1, Math.max(0, (now - state.drainAt) / drainMs));
  return state.from + (state.last - state.from) * progress;
}

/** A label inside the bar needs at least this much height to read. */
function fitsText(ui: Ui, h: number): boolean {
  return h >= ui.theme.type.caption.lineHeight;
}

export function meter(ui: Ui, rect: Rect, opts: MeterOptions): void {
  const { theme, ctx } = ui;
  const skin = skinsFor(theme).meter[opts.kind ?? 'progress'];
  const fraction = opts.max > 0 ? Math.min(1, Math.max(0, opts.value / opts.max)) : 0;
  const shown = ui.tween(`${opts.id}/fill`, fraction, { ms: theme.motion.base });
  const ghost = opts.ghost === false ? shown : ghostLevel(ui, opts.id, fraction);
  const radius = Math.min(skin.radius, rect.h / 2);
  fillRounded(ctx, rect, radius, skin.track);
  const low = opts.lowBelow !== undefined && fraction < opts.lowBelow;
  const fillColor = low ? skin.fillLow : skin.fill;
  const span = (from: number, to: number): Rect => ({
    x: rect.x + rect.w * from,
    y: rect.y,
    w: Math.max(0, rect.w * (to - from)),
    h: rect.h,
  });
  ui.clip(rect, () => {
    if (ghost > shown) {
      fillRounded(ctx, span(0, ghost), radius, skin.ghost);
    }
    if (shown > 0) {
      fillRounded(ctx, span(0, shown), radius, fillColor);
    }
  });
  if (!fitsText(ui, rect.h)) return;
  const inner = inset(rect, { l: theme.space.sm, r: theme.space.sm });
  if (opts.label !== undefined) {
    text(ui, inner, { text: opts.label, role: 'label' });
  }
  if (opts.valueText !== undefined && opts.valueText !== false) {
    const value =
      typeof opts.valueText === 'string'
        ? opts.valueText
        : `${Math.round(opts.value)}/${Math.round(opts.max)}`;
    tabularNumber(ui, inner, { value, role: 'label', align: 'right' });
  }
}
