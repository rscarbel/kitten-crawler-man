/**
 * "Leave this building?" when the crawler stands on the interior doormat.
 * Exit is the default: standing on the mat is how the player asks to leave,
 * and an accidental Exit only puts the party back on the doorstep.
 */

import type { Surface } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { iconUnlessCompact, keyboardHint, stackParts, swallowAttackKey } from './choiceDialogParts';

/** What the interior scene supplies. */
export interface ExitBuildingHooks {
  isOpen(): boolean;
  buildingName(): string;
  exit(): void;
  /** Stay: shut the prompt and remember the refusal until the player steps off the mat. */
  stay(): void;
}

const PROMPT_WIDTH: PanelWidth = 'sm';
const EXIT_BUTTON_INDEX = 1;
const STAY_HINT = 'Esc or Stay to remain inside';

/** The exit prompt as a surface: halts the world and keeps the keyboard while it is up. */
export function exitBuildingPromptSurface(id: string, hooks: ExitBuildingHooks): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => hooks.isOpen(),
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => hooks.stay() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => ({
      id: 'exit-building',
      overline: 'Exit Building',
      icon: iconUnlessCompact(ui, 'logOut'),
      title: `Leave ${hooks.buildingName()}?`,
      extra: stackParts(ui, [keyboardHint(ui, PROMPT_WIDTH, STAY_HINT)]),
      width: PROMPT_WIDTH,
      buttons: [
        { id: 'stay', label: 'Stay', onTap: () => hooks.stay() },
        { id: 'exit', label: 'Exit', onTap: () => hooks.exit() },
      ],
      defaultButton: EXIT_BUTTON_INDEX,
    }),
  });
}
