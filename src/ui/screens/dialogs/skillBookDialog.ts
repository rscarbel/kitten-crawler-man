/**
 * "Read Skill Book?": reading is irreversible and spends the book, so it is
 * the one inventory action that asks first. Read is the default; Escape and
 * Cancel put the book back. A tap outside the card does nothing.
 */

import { getSkillDef } from '../../../core/SkillManager';
import type { SkillBookReadRequest } from '../inventory/InventoryActions';
import {
  SKILL_BOOK_CONSUMED_WARNING,
  SKILL_BOOK_PROMPT_TITLE,
  type SkillBookChoice,
} from '../../SkillBookPrompt';
import { drawSkillIcon } from '../../icons/skillIcons';
import type { Surface } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { powerUpHero, stackParts, swallowAttackKey, textPart } from './choiceDialogParts';

/** What the prompt reads; `SkillBookPrompt` provides it. */
export interface SkillBookPromptSource {
  readonly pendingRequest: SkillBookReadRequest | null;
  bodyText(): string;
}

export interface SkillBookDialogHooks {
  /** Answers the prompt; the owner performs the read and releases the reader it pinned. */
  resolve(choice: SkillBookChoice): void;
  /** Escape: closes the prompt and releases the reader, like Cancel without acting. */
  dismiss(): void;
}

const DIALOG_WIDTH: PanelWidth = 'sm';
const READ_BUTTON_INDEX = 1;
const STILL_PULSE = 1;

/** The read prompt as a modal surface: halts the world and keeps the keyboard. */
export function skillBookDialogSurface(
  id: string,
  source: SkillBookPromptSource,
  hooks: SkillBookDialogHooks,
): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => source.pendingRequest !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => hooks.dismiss() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const request = source.pendingRequest;
      const skillId = request?.skillId ?? null;
      return {
        id: 'skill-book',
        overline: SKILL_BOOK_PROMPT_TITLE,
        title: skillId === null ? '' : getSkillDef(skillId).name,
        body: source.bodyText(),
        hero:
          skillId === null
            ? undefined
            : powerUpHero(ui, {
                pulse: STILL_PULSE,
                poweringUp: false,
                paintIcon: (ctx, icon) => drawSkillIcon(ctx, icon, skillId),
              }),
        extra: stackParts(ui, [textPart(ui, DIALOG_WIDTH, SKILL_BOOK_CONSUMED_WARNING, 'warning')]),
        width: DIALOG_WIDTH,
        buttons: [
          { id: 'cancel', label: 'Cancel', onTap: () => hooks.resolve('cancel') },
          { id: 'read', label: 'Read', onTap: () => hooks.resolve('read') },
        ],
        defaultButton: READ_BUTTON_INDEX,
      };
    },
  });
}
