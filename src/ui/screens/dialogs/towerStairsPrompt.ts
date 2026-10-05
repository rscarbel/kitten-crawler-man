/**
 * The interior staircase prompts. The ordinary one asks "Ascend/Descend to
 * floor X?" with the stairs as the default, since stepping on them is the
 * request. The last flight before a floor's final battle asks the opposite
 * question, so there "No" is the default: a player mashing the accept key up
 * a stairwell must land on the answer that costs them nothing.
 */

import {
  FINALE_BODY_TEXT,
  FINALE_CONFIRM_LABEL,
  FINALE_DECLINE_LABEL,
  type TowerStairPrompt,
} from '../../../systems/TowerStairSystem';
import type { Surface, Ui } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface, type ChoiceModalConfig } from '../../widgets/choiceModal';
import { iconUnlessCompact, keyboardHint, stackParts, swallowAttackKey } from './choiceDialogParts';

/** What the prompt reads and drives; `TowerStairSystem` provides all of it. */
export interface TowerStairsPromptSource {
  readonly prompt: TowerStairPrompt | null;
  takeStairs(): void;
  closeMenu(): void;
}

const PROMPT_WIDTH: PanelWidth = 'sm';
const FINALE_WIDTH: PanelWidth = 'md';
const STAIRS_BUTTON_INDEX = 1;
const FINALE_DECLINE_INDEX = 0;
const STAY_HINT = 'Esc or Stay to remain on this floor';

function promptConfig(
  ui: Ui,
  prompt: TowerStairPrompt | null,
  source: () => TowerStairsPromptSource | null,
): ChoiceModalConfig {
  const close = (): void => source()?.closeMenu();
  const take = (): void => source()?.takeStairs();
  if (prompt?.kind === 'finale') {
    return {
      id: 'tower-stairs-finale',
      overline: 'The Last Flight',
      icon: iconUnlessCompact(ui, 'alert'),
      tone: 'danger',
      title: 'Ready for the final battle?',
      body: FINALE_BODY_TEXT,
      width: FINALE_WIDTH,
      buttons: [
        { id: 'decline', label: FINALE_DECLINE_LABEL, onTap: close },
        { id: 'confirm', label: FINALE_CONFIRM_LABEL, variant: 'danger', onTap: take },
      ],
      defaultButton: FINALE_DECLINE_INDEX,
    };
  }
  const up = prompt?.kind !== 'descend';
  const verb = up ? 'Ascend' : 'Descend';
  return {
    id: 'tower-stairs',
    overline: 'Staircase',
    icon: iconUnlessCompact(ui, up ? 'chevronUp' : 'chevronDown'),
    title: `${verb} to ${prompt?.targetFloorLabel ?? ''}?`,
    extra: stackParts(ui, [keyboardHint(ui, PROMPT_WIDTH, STAY_HINT)]),
    width: PROMPT_WIDTH,
    buttons: [
      { id: 'stay', label: 'Stay', onTap: close },
      { id: 'go', label: verb, onTap: take },
    ],
    defaultButton: STAIRS_BUTTON_INDEX,
  };
}

/** The staircase prompt as a surface: halts the world and keeps the keyboard while it is up. */
export function towerStairsPromptSurface(
  id: string,
  source: () => TowerStairsPromptSource | null,
): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => (source()?.prompt ?? null) !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => source()?.closeMenu() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => promptConfig(ui, source()?.prompt ?? null, source),
  });
}
