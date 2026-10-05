/**
 * A standalone yes/no question: "Deposit 40 stone?", "Abandon this repair?".
 * Owned by whoever asks; mounted once with {@link ConfirmDialog.surface}.
 *
 * No is the default: Enter and Space press the focused answer, or No when
 * nothing is focused, so a stray accept key never commits. Escape and N
 * answer No, Y answers Yes, and every other key is swallowed while it is up.
 * A tap outside the card answers No rather than reaching the world.
 */

import {
  type UiAudio,
  type Band,
  type KeyModifiers,
  type Surface,
  ACTIVATE_KEYS,
  FOCUS_MOVE_KEYS,
  UI_TAP_SOUND,
} from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { choiceModalSurface, type ChoiceButton } from '../../widgets/choiceModal';
import { panelBodyWidth } from '../../widgets/panel';
import { measureTextHeight, text } from '../../widgets/text';

export interface ConfirmDialogOptions {
  readonly title?: string;
  readonly message: string;
  /** Small muted line under the message: a caveat, or where the choice can be revisited. */
  readonly subtext?: string;
  readonly yesLabel: string;
  readonly noLabel: string;
  readonly onYes: () => void;
  readonly onNo: () => void;
  /** Marks Yes as the thing an active quest needs; never set on No. */
  readonly yesQuestRelated?: boolean;
}

const NO_KEYS: ReadonlySet<string> = new Set(['n', 'N']);
const YES_KEYS: ReadonlySet<string> = new Set(['y', 'Y']);
/** Left to the focus ring: Tab and arrows move it, Enter and Space press the focused answer or No. */
const FOCUS_KEYS: ReadonlySet<string> = new Set([...FOCUS_MOVE_KEYS, ...ACTIVATE_KEYS]);
const NO_BUTTON_INDEX = 0;
const CONFIRM_WIDTH: PanelWidth = 'sm';
const UNTITLED_CONFIRM_TITLE = 'Confirm';

export class ConfirmDialog {
  private options: ConfirmDialogOptions | null = null;

  constructor(private readonly audio: UiAudio | null) {}

  get isOpen(): boolean {
    return this.options !== null;
  }

  open(options: ConfirmDialogOptions): void {
    this.options = options;
  }

  close(): void {
    this.options = null;
  }

  private answer(pick: (options: ConfirmDialogOptions) => () => void): void {
    const options = this.options;
    if (options === null) return;
    this.close();
    pick(options)();
  }

  private answerYes(): void {
    this.answer((options) => options.onYes);
  }

  private answerNo(): void {
    this.answer((options) => options.onNo);
  }

  private onKey(key: string, mods: KeyModifiers): boolean {
    if (key === 'Escape' || FOCUS_KEYS.has(key)) return false;
    const fresh = mods.repeat !== true && mods.predatesSurface !== true;
    if (fresh && NO_KEYS.has(key)) {
      this.audio?.play(UI_TAP_SOUND);
      this.answerNo();
    } else if (fresh && YES_KEYS.has(key)) {
      this.audio?.play(UI_TAP_SOUND);
      this.answerYes();
    }
    return true;
  }

  /** The dialog as a surface: halts the world and keeps every key while it is up. */
  surface(id: string, band: Extract<Band, 'modal' | 'system'> = 'modal'): Surface {
    return choiceModalSurface({
      id,
      band,
      isOpen: () => this.isOpen,
      haltsWorld: true,
      locksKeyboard: true,
      escape: {
        kind: 'close',
        onEscape: () => {
          this.audio?.play(UI_TAP_SOUND);
          this.answerNo();
        },
      },
      onKey: (key, mods) => this.onKey(key, mods),
      content: (ui) => {
        const options = this.options;
        const no: ChoiceButton = {
          id: 'no',
          label: options?.noLabel ?? '',
          onTap: () => this.answerNo(),
        };
        const yes: ChoiceButton = {
          id: 'yes',
          label: options?.yesLabel ?? '',
          questRelated: options?.yesQuestRelated === true,
          onTap: () => this.answerYes(),
        };
        const subtext = options?.subtext;
        const subtextHeight =
          subtext === undefined
            ? 0
            : measureTextHeight(ui, panelBodyWidth(ui, CONFIRM_WIDTH), {
                text: subtext,
                role: 'caption',
              });
        return {
          id: 'confirm',
          title: options?.title ?? UNTITLED_CONFIRM_TITLE,
          body: options?.message,
          width: CONFIRM_WIDTH,
          extra:
            subtext === undefined
              ? undefined
              : {
                  height: subtextHeight,
                  draw: (rect) =>
                    text(ui, rect, { text: subtext, role: 'caption', align: 'center', wrap: true }),
                },
          buttons: [no, yes],
          defaultButton: NO_BUTTON_INDEX,
          onScrimTap: () => {
            this.audio?.play(UI_TAP_SOUND);
            this.answerNo();
          },
        };
      },
    });
  }
}
