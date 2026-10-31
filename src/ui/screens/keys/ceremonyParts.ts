/**
 * What the key ceremonies share: the darkened screen, where the stage and
 * the words go, the shake, the Continue button with its guard, and the
 * press handling (a first press finishes the reveal, the next continues).
 */

import { keybindings } from '../../../core/input/Keybindings';
import { centerIn, inset, type Rect } from '../../core/geom';
import { keyLabel, tapVerb } from '../../core/inputMode';
import { ACTIVATE_KEYS, type Surface, type Ui, type UiMeasure } from '../../core/UiRoot';
import { button, buttonHeight } from '../../widgets/button';
import { measureText, text } from '../../widgets/text';
import type { TypeStyle } from '../../theme/tokens';
import { scatter } from '../../../sprites/lightMaps';
import { fitStyleToWidth, headlineStyle } from '../dialogs/endScreenParts';

const HALF = 0.5;

/** Below this viewport height a wide screen puts the stage beside the words rather than above them. */
const SHORT_SCREEN_H = 440;
const SIDE_BY_SIDE_ASPECT = 1.4;
/** The stage's share of the width when it stands beside the words. */
const STAGE_SHARE = 0.48;
/** The words never take more than this share of a stacked screen's height. */
const WORDS_MAX_SHARE = 0.55;
/** Room kept clear round the words block, as a cap on how wide it reads. */
const WORDS_MAX_W = 620;

export interface CeremonyLayout {
  /** Where the art plays. */
  readonly stage: Rect;
  /** Where the words go, above the footer. */
  readonly words: Rect;
  readonly footer: Rect;
  readonly sideBySide: boolean;
}

function ceremonyFooterHeight(ui: Pick<Ui, 'theme'>): number {
  return buttonHeight(ui, 'lg');
}

/** Stage above and words under it, or on a short wide screen the stage left and the words right. */
export function ceremonyLayout(
  ui: UiMeasure,
  wordsHeight: (width: number) => number,
): CeremonyLayout {
  const { space } = ui.theme;
  const view = inset(ui.viewport, space.lg);
  const sideBySide = view.h < SHORT_SCREEN_H && view.w >= view.h * SIDE_BY_SIDE_ASPECT;
  const footerH = ceremonyFooterHeight(ui);
  if (sideBySide) {
    const stageW = view.w * STAGE_SHARE;
    const column: Rect = {
      x: view.x + stageW + space.md,
      y: view.y,
      w: view.w - stageW - space.md,
      h: view.h,
    };
    const footer: Rect = { x: column.x, y: column.y + column.h - footerH, w: column.w, h: footerH };
    const room = footer.y - space.md - column.y;
    const wordsW = Math.min(WORDS_MAX_W, column.w);
    const wordsH = Math.min(room, wordsHeight(wordsW));
    const words: Rect = {
      x: column.x + (column.w - wordsW) * HALF,
      y: column.y + (room - wordsH) * HALF,
      w: wordsW,
      h: wordsH,
    };
    return { stage: { x: view.x, y: view.y, w: stageW, h: view.h }, words, footer, sideBySide };
  }
  const footer: Rect = { x: view.x, y: view.y + view.h - footerH, w: view.w, h: footerH };
  const wordsW = Math.min(WORDS_MAX_W, view.w);
  const wordsH = Math.min(view.h * WORDS_MAX_SHARE, wordsHeight(wordsW));
  const words: Rect = {
    x: view.x + (view.w - wordsW) * HALF,
    y: footer.y - space.md - wordsH,
    w: wordsW,
    h: wordsH,
  };
  const stage: Rect = {
    x: view.x,
    y: view.y,
    w: view.w,
    h: Math.max(0, words.y - space.md - view.y),
  };
  return { stage, words, footer, sideBySide };
}

/** Fills the whole screen with the deepest black at `alpha`. */
export function paintCeremonyBackdrop(ui: Ui, alpha: number): void {
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = ui.theme.palette.surface.blackout;
  ctx.fillRect(ui.screen.x, ui.screen.y, ui.screen.w, ui.screen.h);
  ctx.restore();
}

const SHAKE_FREQ_X = 1.7;
const SHAKE_FREQ_Y = 2.3;
const SHAKE_SEED = 31;

/** The offset a shake of strength `amount` (0 to 1) puts the stage at on `frame`, at most `maxPx` either way. */
export function shakeOffset(
  frame: number,
  amount: number,
  maxPx: number,
): { x: number; y: number } {
  if (amount <= 0) return { x: 0, y: 0 };
  const jitter = (stream: number): number => scatter(SHAKE_SEED + frame * stream) * 2 - 1;
  return {
    x: jitter(SHAKE_FREQ_X) * amount * maxPx,
    y: jitter(SHAKE_FREQ_Y) * amount * maxPx,
  };
}

/** Continue is never narrower than this many control heights. */
const CONTINUE_MIN_CONTROLS = 4;

function skipHint(ui: Ui): string {
  const verb = tapVerb(ui.density);
  return ui.density === 'touch'
    ? `${verb} to skip`
    : `${verb} or press ${keyLabel('attack')} to skip`;
}

/**
 * The footer: a hint to skip while the reveal plays, then the Continue
 * button, inert until its guard has passed.
 */
export function paintCeremonyFooter(
  ui: Ui,
  footer: Rect,
  opts: {
    readonly settled: boolean;
    readonly label: string;
    readonly ready: boolean;
    readonly alpha: number;
    readonly onContinue: () => void;
  },
): void {
  const { theme, ctx } = ui;
  const { space } = theme;
  ctx.save();
  ctx.globalAlpha *= opts.alpha;
  if (!opts.settled) {
    text(ui, footer, { text: skipHint(ui), role: 'muted', align: 'center', valign: 'middle' });
    ctx.restore();
    return;
  }
  const w = Math.max(
    theme.size.control * CONTINUE_MIN_CONTROLS,
    measureText(ui, opts.label, { role: 'label' }) + space.xl * 2,
  );
  button(ui, centerIn(footer, Math.min(w, footer.w), footer.h), {
    id: 'continue',
    label: opts.label,
    variant: 'primary',
    size: 'lg',
    primary: true,
    disabled: !opts.ready,
    onTap: opts.onContinue,
  });
  ctx.restore();
}

/** While the reveal plays, any tap on the screen skips to its settled state. */
export function registerSkip(ui: Ui, settled: boolean, skip: () => void): void {
  if (settled) return;
  ui.hit('skip', ui.screen, { onTap: skip, focusable: false, sound: null });
}

/** A ceremony's surface: band `modal`, halting the world and keeping the keyboard. */
export function ceremonySurface(
  id: string,
  opts: {
    readonly isOpen: () => boolean;
    readonly render: (ui: Ui) => void;
    /** A press: finish the reveal, or continue once it has settled. */
    readonly advance: () => void;
  },
): Surface {
  return {
    id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: opts.isOpen,
    close: opts.advance,
    render: opts.render,
    onKey: (key, mods) => {
      const accepts = ACTIVATE_KEYS.has(key) || keybindings.actionFor(key) === 'attack';
      if (!accepts) return false;
      if (mods.repeat !== true && mods.predatesSurface !== true) opts.advance();
      return true;
    },
  };
}

/**
 * A ceremony's headline: the end screens' oversized display type, shrunk to
 * fit `maxWidth` on one line, down to the title size a phone can still read
 * at, so a long fragment name is never cut short.
 */
export function ceremonyHeadline(
  ui: Pick<Ui, 'ctx' | 'theme' | 'size'>,
  content: string,
  maxWidth: number,
): TypeStyle {
  return fitStyleToWidth(
    ui,
    content,
    headlineStyle(ui, content, maxWidth),
    ui.theme.type.title,
    maxWidth,
  );
}
