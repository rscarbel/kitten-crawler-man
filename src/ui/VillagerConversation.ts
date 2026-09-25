/**
 * The conversation panel for a Briar Hollow villager: a `DialogBox` with the
 * speaker's name and portrait, and — once the last page has finished typing
 * itself out — a row of numbered choices above it.
 *
 * Knows nothing about villagers or dialogue: it is handed pages of text and a
 * list of choices, and runs whichever choice is picked. The village decides
 * what those are.
 *
 * Controls follow the Bopca's counter: number keys pick a choice, a click or
 * tap on a choice picks it, Space (or a click on the box) skips the typing
 * and turns the page, and on the choice row Space is the polite exit — the
 * row's exit choice, the same thing Escape does.
 *
 * The choices join no focus ring. The conversation floats over live play and
 * ends when the talker walks away, and a ring would take the arrow keys a
 * keyboard player walks with.
 */

import type { AudioManager } from '../audio/AudioManager';
import { DialogBox } from './DialogBox';
import { BUTTON_PRESETS, drawButton, playButtonSound } from './Button';

export interface ConversationChoice {
  readonly label: string;
  run(): void;
  /** The row's way out — what Space picks on the choice row. */
  readonly isExit?: boolean;
}

const CHOICE_BUTTON_WIDTH = 200;
/** Narrower than this and a question like "Where do I use these?" no longer reads; the row wraps instead. */
const MIN_CHOICE_BUTTON_WIDTH = 160;
/**
 * The size a choice's label starts at. `drawButton` shrinks one that does not
 * fit its button, so a long question may be set smaller than its neighbours.
 */
export const VILLAGER_CHOICE_LABEL_SIZE = 12;
/** Tall enough to be a comfortable thumb target on a phone. */
const CHOICE_BUTTON_HEIGHT = 36;
const CHOICE_BUTTON_GAP = 8;
/** Pixels between the dialog box's top edge and the choice rows above it. */
const CHOICE_ROW_GAP = 8;
/** The most choices to a row, however wide the screen. */
const MAX_CHOICES_PER_ROW = 3;
/** The choice rows never start above this, matching the dialog box's own floor. */
const CHOICES_MIN_TOP = 8;
/** Number keys reach this many choices. */
const MAX_NUMBERED_CHOICES = 9;
/** What the typing reveals at a time. */
const REVEAL_MODE = 'sentence';

type Phase = 'closed' | 'line' | 'choices';

export interface ChoiceRect {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The label as drawn, number included. */
  readonly label: string;
}

export class VillagerConversation {
  private box: DialogBox | null = null;
  private phase: Phase = 'closed';
  private pages: readonly string[] = [];
  private pageIndex = 0;
  private choices: readonly ConversationChoice[] = [];
  private choiceRects: ChoiceRect[] = [];

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.phase !== 'closed';
  }

  /** Whether the choice row is showing, rather than a line still being read. */
  get isShowingChoices(): boolean {
    return this.phase === 'choices';
  }

  /**
   * Starts a conversation with a new speaker. `DialogBox` fixes its speaker
   * at construction, so each conversation gets its own.
   */
  open(speakerName: string, portrait: CanvasImageSource | undefined): void {
    this.box = new DialogBox(this.audio, {
      speakerName,
      speakerIcon: portrait,
      revealMode: REVEAL_MODE,
    });
    this.phase = 'line';
    this.pages = [];
    this.pageIndex = 0;
    this.choices = [];
  }

  /** Shows `pages` one after another; the choices return after the last. */
  showPages(pages: readonly string[]): void {
    if (this.box === null || pages.length === 0) return;
    this.pages = pages;
    this.pageIndex = 0;
    this.phase = 'line';
    this.showCurrentPage();
  }

  setChoices(choices: readonly ConversationChoice[]): void {
    this.choices = choices;
  }

  close(): void {
    this.box?.hide();
    this.box = null;
    this.phase = 'closed';
    this.pages = [];
    this.choices = [];
    this.choiceRects = [];
  }

  private showCurrentPage(): void {
    const box = this.box;
    if (box === null) return;
    const total = this.pages.length;
    box.show(
      this.pages[this.pageIndex],
      total > 1 ? { pageIndicator: { current: this.pageIndex + 1, total } } : undefined,
    );
  }

  private get onLastPage(): boolean {
    return this.pageIndex >= this.pages.length - 1;
  }

  /**
   * Whether a choice on offer actually does something besides leave — the
   * row's exit choice (Goodbye or Back) does not count. When this is false
   * the choice row never comes up: the next dismiss picks the exit choice
   * itself, so a conversation with nothing left to ask closes on its own
   * rather than making the player click "Goodbye".
   */
  private get hasSelectableChoice(): boolean {
    return this.choices.some((choice) => choice.isExit !== true);
  }

  /** Advances the typing, and brings the choices up once the last page is read. */
  update(): void {
    const box = this.box;
    if (box === null || this.phase !== 'line') return;
    box.update();
    if (this.onLastPage && box.isFullyRevealed() && this.hasSelectableChoice) {
      this.phase = 'choices';
    }
  }

  /** Space, or a tap on the box: finish the typing, turn the page, or leave. */
  advance(): void {
    const box = this.box;
    if (box === null) return;
    if (!box.isFullyRevealed()) {
      box.skipToEnd();
      return;
    }
    if (!this.onLastPage) {
      this.pageIndex++;
      this.showCurrentPage();
      return;
    }
    const exit = this.choices.find((choice) => choice.isExit === true);
    if (exit !== undefined) {
      this.pick(exit);
      return;
    }
    if (this.choices.length === 0) this.close();
    else this.phase = 'choices';
  }

  private pick(choice: ConversationChoice): void {
    playButtonSound(this.audio);
    choice.run();
  }

  /** The labels of the choices on offer, in their numbered order. */
  get choiceLabels(): readonly string[] {
    return this.choices.map((choice) => choice.label);
  }

  /** Where the choice buttons were last drawn, for checking they all landed on screen. */
  get choiceBounds(): ReadonlyArray<ChoiceRect> {
    return this.choiceRects;
  }

  /** Number keys pick a choice. Returns whether the key was taken. */
  handleKeyDown(key: string): boolean {
    if (this.phase !== 'choices') return false;
    const index = Number.parseInt(key, 10) - 1;
    const inRange =
      Number.isInteger(index) &&
      index >= 0 &&
      index < Math.min(this.choices.length, MAX_NUMBERED_CHOICES);
    if (!inRange) return false;
    this.pick(this.choices[index]);
    return true;
  }

  /** A click or tap on the panel. Returns whether it landed on it. */
  handleClick(mx: number, my: number): boolean {
    if (this.box === null) return false;
    if (this.phase === 'choices') {
      for (const rect of this.choiceRects) {
        const inside =
          mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
        if (inside) {
          this.pick(this.choices[rect.index]);
          return true;
        }
      }
    }
    if (this.box.contains(mx, my)) {
      this.advance();
      return true;
    }
    return false;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const box = this.box;
    if (box === null || this.phase === 'closed') return;
    box.render(ctx);
    this.choiceRects = [];
    if (this.phase !== 'choices') return;

    // Bounded by the box's own width, and wrapped into rows, rather than laid
    // out at a fixed width: a phone canvas is under 400 px, and there the
    // buttons are the only way to choose.
    const boxRect = box.rect();
    const fitsInRow = Math.floor(
      (boxRect.width + CHOICE_BUTTON_GAP) / (MIN_CHOICE_BUTTON_WIDTH + CHOICE_BUTTON_GAP),
    );
    const rowPitch = CHOICE_BUTTON_HEIGHT + CHOICE_BUTTON_GAP;
    // A short screen has room above the box for only so many rows. Rows that
    // do not fit there are laid over the box's text, which has already been
    // read — never off the top of the screen, where a tap could not reach
    // them. Only when they would not fit even over the whole box are they
    // packed narrower than a label can be read at.
    const boxBottom = boxRect.y + boxRect.height;
    const rowsOnScreen = Math.max(
      1,
      Math.floor((boxBottom - CHOICES_MIN_TOP + CHOICE_BUTTON_GAP) / rowPitch),
    );
    let perRow = Math.max(1, Math.min(MAX_CHOICES_PER_ROW, fitsInRow, this.choices.length));
    while (Math.ceil(this.choices.length / perRow) > rowsOnScreen && perRow < this.choices.length) {
      perRow++;
    }
    const rowCount = Math.ceil(this.choices.length / perRow);
    const buttonWidth = Math.min(
      CHOICE_BUTTON_WIDTH,
      (boxRect.width - (perRow - 1) * CHOICE_BUTTON_GAP) / perRow,
    );
    const stackedFromBox =
      boxRect.y - CHOICE_ROW_GAP - CHOICE_BUTTON_HEIGHT - (rowCount - 1) * rowPitch;
    const firstRowY = Math.max(CHOICES_MIN_TOP, stackedFromBox);

    this.choices.forEach((choice, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const inThisRow = Math.min(perRow, this.choices.length - row * perRow);
      const rowWidth = inThisRow * buttonWidth + (inThisRow - 1) * CHOICE_BUTTON_GAP;
      const x =
        boxRect.x + (boxRect.width - rowWidth) / 2 + column * (buttonWidth + CHOICE_BUTTON_GAP);
      const y = firstRowY + row * rowPitch;
      const numbered = index < MAX_NUMBERED_CHOICES;
      const label = numbered ? `${index + 1}. ${choice.label}` : choice.label;
      drawButton(ctx, {
        x,
        y,
        width: buttonWidth,
        height: CHOICE_BUTTON_HEIGHT,
        label,
        ...(choice.isExit === true ? BUTTON_PRESETS.primary : BUTTON_PRESETS.villagerTopic),
        labelSize: VILLAGER_CHOICE_LABEL_SIZE,
        primaryAction: choice.isExit === true,
      });
      this.choiceRects.push({ index, x, y, w: buttonWidth, h: CHOICE_BUTTON_HEIGHT, label });
    });
  }
}
