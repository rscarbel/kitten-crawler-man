/**
 * "Enter this building?" when the crawler steps onto a doorway. Enter is the
 * default; Escape and Leave keep the party outside until they step off and on.
 */

import type { BuildingEntry } from '../../../systems/BuildingSystem';
import type { BuildingKind } from '../../../map/town/townPlan';
import type { Surface } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { iconUnlessCompact, keyboardHint, stackParts, swallowAttackKey } from './choiceDialogParts';

/** What the prompt reads and drives; `BuildingSystem` provides all of it. */
export interface BuildingEntryPromptSource {
  readonly menuEntry: BuildingEntry | null;
  enterActiveBuilding(): void;
  closeMenu(): void;
}

const PROMPT_WIDTH: PanelWidth = 'sm';
const ENTER_BUTTON_INDEX = 1;
const LEAVE_HINT = 'Esc or Leave to stay outside';

const KIND_LABELS: Record<BuildingKind, string> = {
  tower: 'Tower',
  store: 'Shop',
  club: 'Club',
  house: 'House',
};

/**
 * The entry prompt as a surface: halts the world and keeps the keyboard while
 * it is up. `source` is read every frame, so a scene whose building system
 * comes and goes passes a getter.
 */
export function buildingEntryPromptSurface(
  id: string,
  source: () => BuildingEntryPromptSource | null,
): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => (source()?.menuEntry ?? null) !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => source()?.closeMenu() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const entry = source()?.menuEntry ?? null;
      return {
        id: 'building-entry',
        overline: entry === null ? undefined : KIND_LABELS[entry.type],
        icon: iconUnlessCompact(ui, 'chevronRight'),
        title: entry?.name ?? '',
        body: 'Enter this building?',
        extra: stackParts(ui, [keyboardHint(ui, PROMPT_WIDTH, LEAVE_HINT)]),
        width: PROMPT_WIDTH,
        buttons: [
          { id: 'leave', label: 'Leave', onTap: () => source()?.closeMenu() },
          { id: 'enter', label: 'Enter', onTap: () => source()?.enterActiveBuilding() },
        ],
        defaultButton: ENTER_BUTTON_INDEX,
      };
    },
  });
}
