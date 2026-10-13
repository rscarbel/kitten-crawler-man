/**
 * The Nothing: a black void that swallows the wheel screen from the edges in,
 * then two lines of quiet grey text. While the save is still being erased it
 * holds on a slow "…", because the page must not reload into a run that still
 * exists.
 */

import { inset } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { WHEEL_VOID_TYPE, wheelInk } from '../../theme/wheelInk';
import { measureTextHeight, text } from '../../widgets/text';

export interface NothingModel {
  /** 0 before the void moves, 1 once it covers everything. */
  readonly swallow: number;
  /** Milliseconds since the first line appeared; negative before it does. */
  readonly firstLineAgeMs: number;
  readonly secondLineAgeMs: number;
  /** The cinematic is over but the wipe has not finished. */
  readonly holding: boolean;
  /** The storage wants the player to sign in again before it will erase the save. */
  readonly signInRequired: boolean;
  readonly nowMs: number;
}

export const NOTHING_FIRST_LINE = 'You have been sent to the Nothing.';
export const NOTHING_SECOND_LINE = 'Everything is gone.';
const HOLD_GLYPH = '…';
export const NOTHING_SIGN_IN_HINT = 'Sign in again to finish erasing your save.';

const LINE_FADE_MS = 900;
const HOLD_PULSE_MS = 1800;
/** The soft inner edge of the void, as a share of the hole still open. */
const VOID_FEATHER_SHARE = 0.45;
/** The void moves slowly, then closes fast at the end. */
const SWALLOW_EASE_POWER = 2.2;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

function fadeIn(ageMs: number): number {
  return Math.max(0, Math.min(1, ageMs / LINE_FADE_MS));
}

export function paintNothing(ui: Ui, model: NothingModel): void {
  const { ctx, screen, theme } = ui;
  if (model.swallow <= 0) return;
  ctx.save();
  const cx = screen.x + screen.w * HALF;
  const cy = screen.y + screen.h * HALF;
  const reach = Math.hypot(screen.w, screen.h) * HALF;
  const closing = Math.pow(model.swallow, SWALLOW_EASE_POWER);
  const outer = reach * (1 - closing);
  if (outer <= 1) {
    ctx.fillStyle = wheelInk.void;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  } else {
    const void_ = ctx.createRadialGradient(cx, cy, outer * (1 - VOID_FEATHER_SHARE), cx, cy, outer);
    void_.addColorStop(0, withAlpha(wheelInk.void, 0));
    void_.addColorStop(1, wheelInk.void);
    ctx.fillStyle = void_;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  }
  ctx.restore();

  const area = inset(ui.viewport, theme.space.xl);
  const lineH = measureTextHeight(ui, area.w, { text: NOTHING_FIRST_LINE, style: WHEEL_VOID_TYPE });
  const secondH = measureTextHeight(ui, area.w, {
    text: NOTHING_SECOND_LINE,
    style: WHEEL_VOID_TYPE,
  });
  const gap = theme.space.xl;
  const total = lineH + gap + secondH;
  const top = area.y + (area.h - total) * HALF;
  const first = fadeIn(model.firstLineAgeMs);
  if (first > 0) {
    text(
      ui,
      { x: area.x, y: top, w: area.w, h: lineH },
      {
        text: NOTHING_FIRST_LINE,
        style: WHEEL_VOID_TYPE,
        color: withAlpha(wheelInk.voidText, first),
        align: 'center',
        wrap: true,
      },
    );
  }
  const second = fadeIn(model.secondLineAgeMs);
  if (second > 0) {
    text(
      ui,
      { x: area.x, y: top + lineH + gap, w: area.w, h: secondH },
      {
        text: NOTHING_SECOND_LINE,
        style: WHEEL_VOID_TYPE,
        color: withAlpha(wheelInk.voidText, second),
        align: 'center',
        wrap: true,
      },
    );
  }
  if (model.holding) {
    const beat = (Math.sin((model.nowMs / HOLD_PULSE_MS) * FULL_TURN) + 1) * HALF;
    text(
      ui,
      { x: area.x, y: top + total + gap, w: area.w, h: lineH },
      {
        text: HOLD_GLYPH,
        style: WHEEL_VOID_TYPE,
        color: withAlpha(wheelInk.voidMuted, HALF + beat * HALF),
        align: 'center',
      },
    );
    if (model.signInRequired) {
      text(
        ui,
        { x: area.x, y: top + total + gap + lineH, w: area.w, h: lineH },
        {
          text: NOTHING_SIGN_IN_HINT,
          role: 'body',
          color: wheelInk.voidMuted,
          align: 'center',
          wrap: true,
        },
      );
    }
  }
}
