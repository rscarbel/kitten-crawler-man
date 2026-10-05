/**
 * "New Ability!", "New Skill!", "New Item!": the granted icon powers up, then
 * its description and OK appear. Queued rewards show one after another.
 *
 * Escape passes beneath. Until the pulse has finished OK is not there to press
 * and the attack key is swallowed; after it, Space and Enter press OK.
 */

import type { RewardGrantedView } from '../../RewardGrantedDialog';
import type { Surface } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { powerUpHero, stackParts, swallowAttackKey, textPart } from './choiceDialogParts';
import { revealFooterReserve } from './levelUpDialog';

/** What the dialog reads and drives; `RewardGrantedDialog` provides all of it. */
export interface RewardGrantedSource {
  readonly view: RewardGrantedView | null;
  acknowledge(): void;
}

const DIALOG_WIDTH: PanelWidth = 'sm';
const OK_BUTTON_INDEX = 0;

export interface RewardGrantedSurfaceOptions {
  /** Narrows when the card may show, e.g. not while a level-up is up. Defaults to always. */
  readonly shownWhen?: () => boolean;
}

/** The reward card as a system surface: halts the world and keeps the keyboard. */
export function rewardGrantedSurface(
  id: string,
  source: RewardGrantedSource,
  opts: RewardGrantedSurfaceOptions = {},
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
      if (view === null) return { id: 'reward-granted', title: '', buttons: [] };
      const reward = view.reward;
      const description = textPart(ui, DIALOG_WIDTH, reward.description, 'secondary');
      return {
        id: 'reward-granted',
        overline: view.heading,
        title: reward.name,
        hero: powerUpHero(ui, {
          pulse: view.iconPulse,
          poweringUp: view.poweringUp,
          paintIcon: (ctx, icon) => reward.renderIcon(ctx, icon),
        }),
        extra: stackParts(ui, [
          view.settled ? description : { height: description.height, draw: () => undefined },
          view.settled ? null : revealFooterReserve(ui),
        ]),
        width: DIALOG_WIDTH,
        buttons: view.settled ? [{ id: 'ok', label: 'OK', onTap: () => source.acknowledge() }] : [],
        defaultButton: OK_BUTTON_INDEX,
      };
    },
  });
}
