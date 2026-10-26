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
} from '../../../core/difficulty/difficultyProfiles';
import { settings } from '../../../core/input/Settings';
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

/** What an owner asks the gate for: the activity, and what to do with the answer. */
export interface ActivityDifficultyRequest {
  /** The activity's name, shown as the picker's title. */
  readonly activity: string;
  /** Receives the tier to play at, once the player has settled on one. */
  readonly onPick: (difficulty: Difficulty) => void;
  /** Escape on the picker: nothing starts. */
  readonly onCancel?: () => void;
}

/** How a gate learns there is a run in progress that a pick could throw away. */
export interface ActivityStartOver {
  /** The tier of the run in progress, or null when there is nothing to lose. */
  readonly inProgress: () => Difficulty | null;
}

/** The id the "Start over?" confirm is mounted under, beside its picker's `idPrefix`. */
const DISCARD_SURFACE_SUFFIX = '-discard';

/**
 * One activity's difficulty question, from the picker through the optional
 * "Start over?" confirm to the owner's callback. An owner keeps one gate,
 * mounts {@link surfaces} once and calls {@link open} each time the activity
 * is used. Built with an {@link ActivityStartOver}, a pick at another tier
 * than the run in progress asks before the run is thrown away; built without
 * one, every pick goes straight to the owner.
 */
export class ActivityDifficultyGate {
  private request: ActivityDifficultyRequest | null = null;
  private pickerOpen = false;
  private discardTo: Difficulty | null = null;

  constructor(private readonly startOver: ActivityStartOver | null = null) {}

  /** Asks which tier to play `request.activity` at, replacing any question already up. */
  open(request: ActivityDifficultyRequest): void {
    this.request = request;
    this.pickerOpen = true;
    this.discardTo = null;
  }

  /** The picker's Escape: the question closes and the owner hears `onCancel`. */
  cancel(): void {
    const request = this.request;
    this.close();
    request?.onCancel?.();
  }

  /**
   * The picker's answer. A tier other than the run in progress asks first,
   * because the picker defaults to the world difficulty and a bare accept key
   * would otherwise throw a run at another tier away.
   */
  choose(difficulty: Difficulty): void {
    const request = this.request;
    if (request === null || !this.pickerOpen) return;
    const inProgress = this.inProgressTier();
    if (inProgress !== null && inProgress !== difficulty) {
      this.pickerOpen = false;
      this.discardTo = difficulty;
      return;
    }
    this.close();
    request.onPick(difficulty);
  }

  /** The confirm's "Keep": the run in progress carries on at its own tier. */
  keep(): void {
    const request = this.request;
    const kept = this.inProgressTier();
    if (request === null || this.discardTo === null) return;
    this.close();
    if (kept !== null) request.onPick(kept);
  }

  /** The confirm's "Start": the run is dropped and the picked tier starts afresh. */
  discard(): void {
    const request = this.request;
    const next = this.discardTo;
    if (request === null || next === null) return;
    this.close();
    request.onPick(next);
  }

  /** The confirm's Escape: back to the picker. */
  back(): void {
    if (this.request === null || this.discardTo === null) return;
    this.discardTo = null;
    this.pickerOpen = true;
  }

  /** Drops the question without telling the owner, as a checkpoint rewind does. */
  close(): void {
    this.request = null;
    this.pickerOpen = false;
    this.discardTo = null;
  }

  get isPickerOpen(): boolean {
    return this.pickerOpen;
  }

  get isConfirmOpen(): boolean {
    return this.discardTo !== null;
  }

  /** Whether either step of the question is on screen. */
  get isOpen(): boolean {
    return this.pickerOpen || this.discardTo !== null;
  }

  /**
   * The picker under `idPrefix` and, for a gate with a start-over step, its
   * confirm under `idPrefix` + "-discard", for the owner to mount once.
   */
  surfaces(idPrefix: string): readonly Surface[] {
    const picker = activityDifficultyPickerSurface(idPrefix, () => this.pickerState());
    if (this.startOver === null) return [picker];
    return [
      picker,
      activityDiscardConfirmSurface(`${idPrefix}${DISCARD_SURFACE_SUFFIX}`, () =>
        this.confirmState(),
      ),
    ];
  }

  private inProgressTier(): Difficulty | null {
    return this.startOver?.inProgress() ?? null;
  }

  private pickerState(): ActivityDifficultyPick | null {
    const request = this.request;
    if (request === null || !this.pickerOpen) return null;
    return {
      activity: request.activity,
      inProgress: this.inProgressTier(),
      pick: (difficulty) => this.choose(difficulty),
      cancel: () => this.cancel(),
    };
  }

  private confirmState(): ActivityDiscardConfirm | null {
    const request = this.request;
    const to = this.discardTo;
    const from = this.inProgressTier();
    if (request === null || to === null || from === null) return null;
    return {
      activity: request.activity,
      from,
      to,
      keep: () => this.keep(),
      discard: () => this.discard(),
      back: () => this.back(),
    };
  }
}
