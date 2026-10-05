/**
 * "X Level Up!": the icon powers up, the level counts up, then the new perk
 * and OK appear. Queued level-ups show one after another.
 *
 * Escape passes beneath (there is nothing to cancel). Until the count-up has
 * landed OK is not there to press and the attack key is swallowed; after it,
 * Space and Enter press OK.
 */

import type { LevelUpView } from '../../LevelUpDialog';
import type { Surface, Ui } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { buttonHeight } from '../../widgets/button';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { lineHeightOf, text } from '../../widgets/text';
import {
  powerUpHero,
  stackParts,
  swallowAttackKey,
  textPart,
  type ExtraPart,
} from './choiceDialogParts';

/** What the dialog reads and drives; `LevelUpDialog` provides all of it. */
export interface LevelUpSource {
  readonly view: LevelUpView | null;
  acknowledge(): void;
}

const DIALOG_WIDTH: PanelWidth = 'sm';
const OK_BUTTON_INDEX = 0;
/** How much the level number swells at the height of the count-up. */
const COUNT_UP_SWELL = 0.5;
const HALF = 0.5;

/** The footer OK will take once it appears, held open so the card doesn't jump. */
export function revealFooterReserve(ui: Ui): ExtraPart {
  return { height: buttonHeight(ui, 'lg') + ui.theme.space.lg, draw: () => undefined };
}

function levelPart(ui: Ui, view: LevelUpView): ExtraPart {
  const height = lineHeightOf(ui, 'heading');
  return {
    height,
    draw: (rect) => {
      const scale = 1 + Math.sin(view.countUpProgress * Math.PI) * COUNT_UP_SWELL;
      const { ctx } = ui;
      const cx = rect.x + rect.w * HALF;
      const cy = rect.y + rect.h * HALF;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      text(ui, rect, {
        text: `Level ${view.displayedLevel}`,
        role: 'heading',
        color: ui.theme.palette.accent.base,
        align: 'center',
        tabular: true,
      });
      ctx.restore();
    },
  };
}

function perkPart(ui: Ui, view: LevelUpView): ExtraPart | null {
  const perk = view.entry.perkDescription;
  if (perk === null) return null;
  const part = textPart(ui, DIALOG_WIDTH, perk, 'secondary');
  return view.settled ? part : { height: part.height, draw: () => undefined };
}

export interface LevelUpSurfaceOptions {
  /** Narrows when the card may show, e.g. not while a quest reward is up. Defaults to always. */
  readonly shownWhen?: () => boolean;
}

/** The level-up card as a system surface: halts the world and keeps the keyboard. */
export function levelUpSurface(
  id: string,
  source: LevelUpSource,
  opts: LevelUpSurfaceOptions = {},
): Surface {
  const shownWhen = opts.shownWhen ?? (() => true);
  return choiceModalSurface({
    id,
    band: 'system',
    isOpen: () => source.view !== null && shownWhen(),
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'pass' },
    onKey: (key, mods) => swallowAttackKey(key, mods, source.view?.settled === true),
    content: (ui) => {
      const view = source.view;
      if (view === null) return { id: 'level-up', title: '', buttons: [] };
      const entry = view.entry;
      return {
        id: 'level-up',
        overline: 'Level up',
        title: entry.name,
        hero: powerUpHero(ui, {
          pulse: view.iconPulse,
          poweringUp: view.poweringUp,
          paintIcon: (ctx, icon) => entry.renderIcon(ctx, icon, entry.newLevel),
        }),
        extra: stackParts(ui, [
          levelPart(ui, view),
          perkPart(ui, view),
          view.settled ? null : revealFooterReserve(ui),
        ]),
        width: DIALOG_WIDTH,
        buttons: view.settled ? [{ id: 'ok', label: 'OK', onTap: () => source.acknowledge() }] : [],
        defaultButton: OK_BUTTON_INDEX,
      };
    },
  });
}
