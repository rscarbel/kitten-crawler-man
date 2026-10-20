/**
 * A question the show's AI puts to the player ("Viewers want to know: save
 * the cat or the loot?"), with one button per answer. It halts the world
 * while it is up, so nothing hits the party mid-thought.
 *
 * No answer is the default: Space and Enter press nothing until a button is
 * focused, so a key held from the fight cannot answer for the player. Escape
 * waves the question away, which the AI hears as no answer.
 */

import { displayNameOf } from '../../../ai/AIChatFeed';
import { SYSTEM_CHARACTER_NAME } from '../../../ai/characters';
import type { Surface } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { iconUnlessCompact, keyboardHint, swallowAttackKey } from './choiceDialogParts';

/** A question on screen. */
export interface PendingAIQuestion {
  readonly id: string;
  readonly question: string;
  readonly choices: readonly string[];
  readonly askedBy: string;
}

/** What the prompt reads and drives. */
export interface AIQuestionSource {
  readonly pendingQuestion: PendingAIQuestion | null;
  /** The player picked `choices[index]`. */
  answer(index: number): void;
  /** The player waved the question away. */
  dismissQuestion(): void;
}

const PROMPT_WIDTH: PanelWidth = 'sm';
/** Four answers sit two by two where their labels fit; fewer stack or share a row. */
const GRID_FROM_CHOICES = 4;
const GRID_COLUMNS = 2;
const SILENT_HINT = 'Esc to say nothing';

export function aiQuestionSurface(id: string, source: AIQuestionSource): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => source.pendingQuestion !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => source.dismissQuestion() },
    onKey: (key, mods) => swallowAttackKey(key, mods, false),
    content: (ui) => {
      const pending = source.pendingQuestion;
      const choices = pending?.choices ?? [];
      return {
        id: `question-${pending?.id ?? 'none'}`,
        overline: `${displayNameOf(pending?.askedBy ?? SYSTEM_CHARACTER_NAME)} asks`,
        icon: iconUnlessCompact(ui, 'eye'),
        tone: 'info',
        title: pending?.question ?? '',
        extra: keyboardHint(ui, PROMPT_WIDTH, SILENT_HINT) ?? undefined,
        width: PROMPT_WIDTH,
        buttonColumns: choices.length >= GRID_FROM_CHOICES ? GRID_COLUMNS : undefined,
        buttons: choices.map((label, index) => ({
          id: `answer-${index}`,
          label,
          variant: 'secondary',
          onTap: () => source.answer(index),
        })),
      };
    },
  });
}
