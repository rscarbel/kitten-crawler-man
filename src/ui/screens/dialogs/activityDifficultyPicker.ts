/**
 * "Play this at which difficulty?" before a self-contained activity starts.
 * The world difficulty is the default, so a bare accept key carries on at it;
 * the pick applies to that one activity and never touches the setting.
 * Escape backs out without starting.
 */

import {
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  type Difficulty,
} from '../../../core/difficultyProfiles';
import { settings } from '../../../core/Settings';
import type { Surface } from '../../core/UiRoot';
import type { GlyphId } from '../../theme/glyphs';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface, type ChoiceButton } from '../../widgets/choiceModal';
import {
  iconUnlessCompact,
  keyboardHint,
  stackParts,
  swallowAttackKey,
  textPart,
} from './choiceDialogParts';

/** An activity waiting on its difficulty. */
export interface ActivityDifficultyPick {
  /** The activity's name, shown as the title. */
  readonly activity: string;
  /** The tier of a run the player has already made progress on, marked on its button. */
  readonly inProgress?: Difficulty | null;
  readonly pick: (difficulty: Difficulty) => void;
  readonly cancel: () => void;
}

/** A pick that would throw away progress, waiting on the player to say so. */
export interface ActivityDiscardConfirm {
  readonly activity: string;
  readonly from: Difficulty;
  readonly to: Difficulty;
  /** Carry on with the run in progress. */
  readonly keep: () => void;
  /** Throw it away and start afresh at `to`. */
  readonly discard: () => void;
  /** Escape: back to the picker. */
  readonly back: () => void;
}

/** Wide enough that three tier buttons share one row at their full labels. */
const PICKER_WIDTH: PanelWidth = 'md';
const CONFIRM_WIDTH: PanelWidth = 'sm';
const CANCEL_HINT = 'Esc to back out';
const CONFIRM_HINT = 'Esc to choose again';
/** Every tier sits in one pinned row, so none falls below the fold on a short screen. */
const TIERS_PER_ROW = DIFFICULTY_ORDER.length;
const IN_PROGRESS_GLYPH: GlyphId = 'hourglass';
const KEEP_BUTTON_INDEX = 0;

function worldDifficultyNote(): string {
  return `Only this activity changes. Your world stays on ${DIFFICULTY_LABELS[settings.difficulty]}.`;
}

function inProgressNote(tier: Difficulty): string {
  return `Your ${DIFFICULTY_LABELS[tier]} run is in progress; picking another tier starts over.`;
}

/**
 * The picker as a surface: halts the world and keeps the keyboard while
 * `pending` returns a pick, which it reads every frame.
 */
export function activityDifficultyPickerSurface(
  id: string,
  pending: () => ActivityDifficultyPick | null,
): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => pending() !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => pending()?.cancel() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const current = pending();
      const inProgress = current?.inProgress ?? null;
      const buttons: ChoiceButton[] = DIFFICULTY_ORDER.map((difficulty) => ({
        id: difficulty,
        label: DIFFICULTY_LABELS[difficulty],
        icon: difficulty === inProgress ? IN_PROGRESS_GLYPH : undefined,
        onTap: () => current?.pick(difficulty),
      }));
      return {
        id: 'activity-difficulty',
        overline: 'Choose difficulty',
        icon: iconUnlessCompact(ui, 'swords'),
        title: current?.activity ?? '',
        body: worldDifficultyNote(),
        extra: stackParts(ui, [
          inProgress === null
            ? null
            : textPart(ui, PICKER_WIDTH, inProgressNote(inProgress), 'muted'),
          keyboardHint(ui, PICKER_WIDTH, CANCEL_HINT),
        ]),
        width: PICKER_WIDTH,
        buttons,
        buttonsPerRow: TIERS_PER_ROW,
        defaultButton: DIFFICULTY_ORDER.indexOf(settings.difficulty),
      };
    },
  });
}

/**
 * "Start over?" when a pick would throw away a run in progress. Keeping the
 * run is the default, so a stray accept key never loses it.
 */
export function activityDiscardConfirmSurface(
  id: string,
  pending: () => ActivityDiscardConfirm | null,
): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => pending() !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => pending()?.back() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const current = pending();
      const from = current === null ? '' : DIFFICULTY_LABELS[current.from];
      const to = current === null ? '' : DIFFICULTY_LABELS[current.to];
      return {
        id: 'activity-discard',
        overline: current?.activity,
        icon: iconUnlessCompact(ui, 'alert'),
        tone: 'danger',
        title: 'Start over?',
        body: `Switching to ${to} throws away your ${from} progress.`,
        extra: stackParts(ui, [keyboardHint(ui, CONFIRM_WIDTH, CONFIRM_HINT)]),
        width: CONFIRM_WIDTH,
        buttons: [
          { id: 'keep', label: `Keep ${from}`, onTap: () => current?.keep() },
          {
            id: 'discard',
            label: `Start ${to}`,
            variant: 'danger',
            onTap: () => current?.discard(),
          },
        ],
        defaultButton: KEEP_BUTTON_INDEX,
      };
    },
  });
}
