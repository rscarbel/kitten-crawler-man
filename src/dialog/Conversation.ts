/**
 * The one conversation panel every speaker in the game talks through: a
 * `DialogBox` whose speaker row can change line to line, a choice row above
 * it, a reward strip below it, and the accept/decline pair a request can ask
 * for instead of a plain close.
 *
 * Knows nothing about any one speaker or script: it is handed a
 * `ConversationRequest` and runs whatever `Ending` and `DismissPolicy` it
 * names. A caller starts one with `open()`, gets back a `ConversationHandle`,
 * and `play()`s further requests on it to chain into the next beat without
 * leaving the box.
 *
 * Controls: number keys pick a choice or a two-button confirm, a click or
 * tap on the box turns the page, Space skips the typing, turns the page, or
 * — on the choice row — is the row's own exit choice, if it has one.
 */

import type { AudioManager } from '../audio/AudioManager';
import { TILE_SIZE } from '../core/constants';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import { drawItemIcon } from '../ui/InventoryPanel';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { drawText, measureTextBox } from '../ui/TextBox';
import {
  BUTTON_PRESETS,
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  playButtonSound,
} from '../ui/Button';
import { countDisplayPages, DialogBox } from '../ui/DialogBox';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';
import type { DialogLine, NonEmpty } from './line';
import { resolveSpeaker } from './speakers';
import type {
  Choice,
  ConfirmKeyboardDefault,
  ConversationHandle,
  ConversationRequest,
  DialogReward,
  Ending,
  PendingLine,
} from './request';

type Beat = DialogLine | PendingLine;

function isPendingLine(beat: Beat): beat is PendingLine {
  return !('paragraphs' in beat);
}

/** A single-page "…" line, shown while a `PendingLine`'s text is still in flight. */
const PENDING_PLACEHOLDER: NonEmpty<string> = ['…'];

/** Shown in place of a `PendingLine` whose promise rejected, so a failed fetch still ends in a readable page rather than a permanent "…". */
const PENDING_LINE_FAILURE_TEXT = "…that didn't come through. Try asking again.";

const CHOICE_BUTTON_WIDTH = 200;
const MIN_CHOICE_BUTTON_WIDTH = 160;
/**
 * The size a choice's label starts at. `drawButton` shrinks one that does
 * not fit its button, so a long question may be set smaller than its
 * neighbours.
 */
export const CONVERSATION_CHOICE_LABEL_SIZE = 12;
const CHOICE_BUTTON_HEIGHT = 36;
const CHOICE_BUTTON_GAP = 8;
const CHOICE_ROW_GAP = 8;
const MAX_CHOICES_PER_ROW = 3;
const CHOICES_MIN_TOP = 8;
const MAX_NUMBERED_CHOICES = 9;

const FOOTER_PAD_X = 14;
const FOOTER_Y_FROM_BOTTOM = 18;
const FOOTER_HINT_SIZE = 10;
const FOOTER_HINT_COLOR = '#7a6e5a';
const FOOTER_BUTTON_HEIGHT = 22;
const FOOTER_BUTTON_MIN_WIDTH = 90;
const FOOTER_BUTTON_MAX_WIDTH = 220;
const FOOTER_BUTTON_LABEL_PADDING = 24;

const REWARD_STRIP_TOP_GAP = 12;
const REWARD_STRIP_PAD = 9;
const REWARD_ICON_SIZE = 36;
const REWARD_ICON_TEXT_GAP = 10;
const REWARD_HEADING_SIZE = 9;
const REWARD_HEADING_HEIGHT = 13;
const REWARD_NAME_SIZE = 12;
const REWARD_NAME_HEIGHT = 16;
const REWARD_LINE_SIZE = 10;
const REWARD_LINE_SPACING = 13;
const REWARD_XP_SIZE = 10;
const REWARD_XP_HEIGHT = 14;
const REWARD_HEADING_COLOR = 'rgba(148,163,184,0.9)';
const REWARD_NAME_COLOR = '#facc15';
const REWARD_LINE_COLOR = '#cbd5e1';
const REWARD_XP_COLOR = '#4ade80';
const REWARD_HEADING_TEXT = 'REWARD';

/** The keyboard/controller focus ring `Conversation` shares with every load-bearing quest scene it replaces. */
const FOCUS_CONTEXT = 'quest-dialog';

export interface ChoiceRect {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The label as drawn, number included. */
  readonly label: string;
}

interface FooterButtonRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the last line's last page currently has the player choosing between. */
type EndingState =
  | { readonly kind: 'none' }
  | { readonly kind: 'choices'; readonly choices: NonEmpty<Choice> }
  | {
      readonly kind: 'confirm';
      readonly decline: Choice;
      readonly accept: Choice;
      readonly keyboardDefault: ConfirmKeyboardDefault;
    };

export class Conversation {
  private readonly box: DialogBox;
  private request: ConversationRequest | null = null;
  private lineIndex = 0;
  /** The `Beat` object last handed to `box.show()` — reference-compared so a request that repaints the choice row over the very line already on screen doesn't restart its reveal. */
  private activeLineRef: Beat | null = null;
  private ending: EndingState = { kind: 'none' };
  /** Bumped on every `open()`. Guards a `PendingLine`'s promise against resolving into a conversation that has since moved on. */
  private generation = 0;
  /** The text a `PendingLine` resolved to, once its promise settles — `null` while still waiting, and while the active line isn't a `PendingLine` at all. */
  private pendingResolvedText: string | null = null;
  private choiceRowRendered = false;
  private choiceRects: ChoiceRect[] = [];
  private footerButtonRect: FooterButtonRect | null = null;
  /**
   * The handle returned by the `open()` that is currently on screen — unique
   * per open, so a caller can ask `isActive` whether the beat it opened (or
   * chained onto with `play`) is still the one showing, rather than keeping
   * its own boolean in sync with the box by hand.
   */
  private currentHandle: ConversationHandle | null = null;

  constructor(private readonly audio: AudioManager | null) {
    this.box = new DialogBox(audio, { showFooterHint: false });
  }

  get isOpen(): boolean {
    return this.request !== null;
  }

  /** Whether the choice or confirm row is up, rather than a line still being read. */
  get isShowingChoices(): boolean {
    return this.ending.kind !== 'none';
  }

  /** Where the choice or confirm row was last drawn — for checking every button landed on screen and its label fits it. */
  get choiceBounds(): ReadonlyArray<ChoiceRect> {
    return this.choiceRects;
  }

  /** The labels of the choices on offer, in their numbered order — empty while nothing is up to choose from. */
  get choiceLabels(): readonly string[] {
    return this.currentChoiceRow().map((choice) => choice.label);
  }

  /**
   * Starts a new conversation, replacing any already open. Returns the
   * handle further beats chain through, and that `isActive` recognises for
   * as long as this beat — or anything it `play`s onto the same box — stays
   * on screen.
   *
   * A request this supersedes is dismissed first: an `allowed` one is closed
   * and runs its `onDismissed`, so its owner releases whatever target or
   * latch it held, exactly as if the player had walked away from it — and
   * because the box is already empty by then, nothing that `onDismissed`
   * does to the box can reach the request opened here. A `blocked` request
   * has no `onDismissed` to run — callers must not open over one; see
   * `isOpen`.
   */
  open(request: ConversationRequest): ConversationHandle {
    const superseded = this.request;
    // Bumped before the superseded owner's `onDismissed` runs, so a stale
    // handle it still holds is already inert by then.
    this.generation++;
    const openGeneration = this.generation;
    if (superseded !== null && superseded.dismiss.kind === 'allowed') {
      const onDismissed = superseded.dismiss.onDismissed;
      this.doClose();
      onDismissed();
    }
    const handle: ConversationHandle = {
      play: (next) => {
        if (this.generation === openGeneration) this.begin(next, false);
      },
      close: () => {
        if (this.generation === openGeneration) this.doClose();
      },
    };
    this.currentHandle = handle;
    this.begin(request, true);
    return handle;
  }

  /** Whether `handle` is the one currently on screen — the beat it opened, or anything it chained onto the box with `play`, is what `Conversation` is showing right now. */
  isActive(handle: ConversationHandle): boolean {
    return this.currentHandle === handle;
  }

  /** Esc: no-op while `dismiss` is `blocked`; otherwise closes and runs `onDismissed`. Returns whether there was a conversation open to act on. */
  dismiss(): boolean {
    const request = this.request;
    if (request === null) return false;
    if (request.dismiss.kind === 'blocked') return true;
    const onDismissed = request.dismiss.onDismissed;
    this.doClose();
    onDismissed();
    return true;
  }

  /** Closes with no side effect — a `Choice.run` backing out of the conversation outright. */
  close(): void {
    if (this.request === null) return;
    this.doClose();
  }

  private begin(request: ConversationRequest, freshOpen: boolean): void {
    const priorRequest = this.request;
    // A menu repaint chains a single-line request whose one line is
    // reference-identical to the line already fully read on screen, and that
    // line was the *last* one of the request it repaints — never a line
    // still mid-sequence. Only then does its ending apply at once instead of
    // waiting for a future `update()` tick to notice a freshly-revealed page.
    const isMenuRepaint =
      !freshOpen &&
      priorRequest !== null &&
      request.lines.length === 1 &&
      this.activeLineRef === request.lines[0] &&
      this.lineIndex === priorRequest.lines.length - 1;
    this.request = request;
    this.choiceRowRendered = false;
    if (isMenuRepaint) {
      this.ending = { kind: 'none' };
      this.applyEnding(request.ending);
      return;
    }
    this.lineIndex = 0;
    this.ending = { kind: 'none' };
    this.showLineAt(0);
  }

  private showLineAt(index: number): void {
    const request = this.request;
    if (request === null) return;
    const line = request.lines[index];
    this.activeLineRef = line;
    this.pendingResolvedText = null;
    if (isPendingLine(line)) {
      const speaker = resolveSpeaker(line.speaker);
      this.box.show(PENDING_PLACEHOLDER, speaker, {
        questRelated: false,
        pageIndicator: () => null,
      });
      const generationAtRequest = this.generation;
      const showResolved = (text: string): void => {
        if (this.generation !== generationAtRequest || this.activeLineRef !== line) return;
        this.pendingResolvedText = text;
        this.box.show([text], speaker, {
          questRelated: request.questRelated,
          pageIndicator: () => null,
        });
      };
      void line.text.then(showResolved, () => showResolved(PENDING_LINE_FAILURE_TEXT));
      return;
    }
    const speaker = resolveSpeaker(line.speaker);
    this.box.show(line.paragraphs, speaker, {
      questRelated: request.questRelated,
      pageIndicator: () => null,
    });
  }

  /** Whether the line at `index` is still a `PendingLine` whose promise hasn't settled — the box shows "…" and nothing can advance past it. */
  private isLineStillPending(request: ConversationRequest, index: number): boolean {
    return isPendingLine(request.lines[index]) && this.pendingResolvedText === null;
  }

  private applyEnding(ending: Ending): void {
    switch (ending.kind) {
      case 'close': {
        const onClosed = ending.onClosed;
        this.doClose();
        onClosed();
        return;
      }
      case 'choices':
        this.ending = { kind: 'choices', choices: ending.choices };
        return;
      case 'confirm':
        this.ending = {
          kind: 'confirm',
          decline: ending.decline,
          accept: ending.accept,
          keyboardDefault: ending.keyboardDefault,
        };
        return;
    }
  }

  private doClose(): void {
    this.box.hide();
    this.request = null;
    this.currentHandle = null;
    this.lineIndex = 0;
    this.activeLineRef = null;
    this.ending = { kind: 'none' };
    this.choiceRowRendered = false;
    this.choiceRects = [];
    this.footerButtonRect = null;
  }

  /** Call once per frame. `playerPosition` drives `dismiss: 'allowed'` walk-away; pass `null` when this conversation has nothing in the world to walk away from. */
  update(playerPosition: { readonly x: number; readonly y: number } | null): void {
    const request = this.request;
    if (request === null) return;
    this.box.update();
    this.checkWalkAway(request, playerPosition);
    if (this.request === null) return;
    if (this.ending.kind !== 'none') return;
    if (this.isLineStillPending(request, this.lineIndex)) return;
    const doneReading = this.box.isLastPageOfLine() && this.box.isFullyRevealed();
    if (!doneReading) return;
    const isLastLine = this.lineIndex === request.lines.length - 1;
    if (!isLastLine) return;
    // A 'close' ending waits for an explicit advance(): the box should not
    // vanish out from under a player the instant the last character reveals.
    // 'choices' and 'confirm' only add a row over a page still on screen, so
    // they come up as soon as it's fully read — the same moment the villager
    // box has always brought its choice row up.
    if (request.ending.kind === 'close') return;
    this.applyEnding(request.ending);
  }

  private checkWalkAway(
    request: ConversationRequest,
    playerPosition: { readonly x: number; readonly y: number } | null,
  ): void {
    if (request.dismiss.kind !== 'allowed') return;
    const anchor = request.anchor;
    if (anchor === null || playerPosition === null) return;
    const speakerPosition = anchor.position();
    const tileDistance =
      Math.hypot(playerPosition.x - speakerPosition.x, playerPosition.y - speakerPosition.y) /
      TILE_SIZE;
    if (tileDistance <= anchor.radius) return;
    const onDismissed = request.dismiss.onDismissed;
    this.doClose();
    onDismissed();
  }

  /** Space, or a tap on the box: skip the typing, turn the page, activate a custom-advance button, or leave the choice/confirm row by its exit choice. */
  advance(): void {
    const request = this.request;
    if (request === null) return;
    if (this.isLineStillPending(request, this.lineIndex)) return;
    if (!this.box.isFullyRevealed()) {
      this.box.skipToEnd();
      return;
    }
    if (this.ending.kind === 'choices') {
      if (!this.choiceRowRendered) return;
      const exit = this.ending.choices.find((choice) => choice.tone === 'exit');
      if (exit !== undefined) this.runChoice(exit);
      return;
    }
    if (this.ending.kind === 'confirm') {
      if (!this.choiceRowRendered) return;
      if (this.ending.keyboardDefault === 'accept') this.runChoice(this.ending.accept);
      else if (this.ending.keyboardDefault === 'decline') this.runChoice(this.ending.decline);
      return;
    }
    if (!this.box.isLastPageOfLine()) {
      this.box.advancePage();
      return;
    }
    const isLastLine = this.lineIndex === request.lines.length - 1;
    if (!isLastLine) {
      this.lineIndex++;
      this.showLineAt(this.lineIndex);
      return;
    }
    // The last page of the last line, with no ending applied yet this frame:
    // `update()` runs first every frame, so this only fires the same tick the
    // reveal itself finished — `applyEnding` here keeps a click that lands in
    // that same frame from being swallowed.
    this.applyEnding(request.ending);
  }

  private runChoice(choice: Choice): void {
    const handle = this.currentHandle;
    if (handle === null) return;
    playButtonSound(this.audio);
    choice.run(handle);
  }

  /** Number keys: pick a choice, or a confirm side (1 = decline, 2 = accept), or activate a custom-advance button standing in for "1". Returns whether the key was taken. */
  handleKeyDown(key: string): boolean {
    if (this.request === null) return false;
    if (this.ending.kind === 'choices') {
      const index = Number.parseInt(key, 10) - 1;
      const inRange =
        Number.isInteger(index) &&
        index >= 0 &&
        index < Math.min(this.ending.choices.length, MAX_NUMBERED_CHOICES);
      if (!inRange) return false;
      this.runChoice(this.ending.choices[index]);
      return true;
    }
    if (this.ending.kind === 'confirm') {
      if (key === '1') {
        this.runChoice(this.ending.decline);
        return true;
      }
      if (key === '2') {
        this.runChoice(this.ending.accept);
        return true;
      }
      return false;
    }
    if (key === '1' && this.footerButtonRect !== null) {
      this.advance();
      return true;
    }
    return false;
  }

  /** A click or tap. Returns whether it landed on this conversation. */
  handleClick(mx: number, my: number): boolean {
    if (this.request === null) return false;
    if (this.ending.kind === 'choices' || this.ending.kind === 'confirm') {
      for (const rect of this.choiceRects) {
        if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
          this.runChoice(this.currentChoiceRow()[rect.index]);
          return true;
        }
      }
    }
    if (this.footerButtonRect !== null) {
      const rect = this.footerButtonRect;
      if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
        this.advance();
        return true;
      }
    }
    if (this.box.contains(mx, my)) {
      this.advance();
      return true;
    }
    return false;
  }

  private currentChoiceRow(): readonly Choice[] {
    if (this.ending.kind === 'choices') return this.ending.choices;
    if (this.ending.kind === 'confirm') return [this.ending.decline, this.ending.accept];
    return [];
  }

  /**
   * On a confirm row (`currentChoiceRow()` orders it `[decline, accept]`),
   * which button — if any — is drawn as the one a bare Space would pick.
   */
  private isConfirmPrimaryIndex(index: number): boolean {
    if (this.ending.kind !== 'confirm') return false;
    const confirmDeclineIndex = 0;
    const confirmAcceptIndex = 1;
    if (this.ending.keyboardDefault === 'decline') return index === confirmDeclineIndex;
    if (this.ending.keyboardDefault === 'accept') return index === confirmAcceptIndex;
    return false;
  }

  /** The active line and every line still to come, for the "n / N" indicator across the whole request. */
  private displayPageTotals(request: ConversationRequest): { current: number; total: number } {
    let total = 0;
    let current = 0;
    request.lines.forEach((line, index) => {
      const pages = isPendingLine(line) ? 1 : countDisplayPages(line.paragraphs, false);
      if (index < this.lineIndex) current += pages;
      else if (index === this.lineIndex) current += this.box.currentPageNumber();
      total += pages;
    });
    return { current, total };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const request = this.request;
    if (request === null) return;
    this.box.render(ctx);
    this.choiceRects = [];
    this.footerButtonRect = null;

    const boxRect = this.box.rect();
    this.renderFooter(ctx, request, boxRect);

    if (this.ending.kind === 'choices' || this.ending.kind === 'confirm') {
      this.choiceRowRendered = true;
      this.renderChoiceRow(ctx, boxRect, request.haltsWorld);
      return;
    }

    const isLastLine = this.lineIndex === request.lines.length - 1;
    const onLastPage =
      !this.isLineStillPending(request, this.lineIndex) &&
      this.box.isLastPageOfLine() &&
      this.box.isFullyRevealed();
    if (isLastLine && onLastPage && request.reward !== null) {
      this.renderRewardStrip(ctx, request.reward, boxRect);
    }
  }

  private renderFooter(
    ctx: CanvasRenderingContext2D,
    request: ConversationRequest,
    boxRect: { x: number; y: number; width: number; height: number },
  ): void {
    const footerY = boxRect.y + boxRect.height - FOOTER_Y_FROM_BOTTOM;
    const { current, total } = this.displayPageTotals(request);
    if (total > 1) {
      drawText(ctx, `${current} / ${total}`, {
        x: boxRect.x + FOOTER_PAD_X,
        y: footerY,
        size: FOOTER_HINT_SIZE,
        color: FOOTER_HINT_COLOR,
      });
    }

    if (this.ending.kind !== 'none') return;
    if (this.isLineStillPending(request, this.lineIndex)) return;

    const line = request.lines[this.lineIndex];
    const onLastPageOfLine = this.box.isLastPageOfLine() && this.box.isFullyRevealed();
    if (!isPendingLine(line) && onLastPageOfLine && line.advance.kind === 'custom') {
      this.renderFooterButton(ctx, line.advance.label, boxRect, footerY);
      return;
    }

    const label = !this.box.isFullyRevealed()
      ? 'Skip'
      : onLastPageOfLine
        ? this.lineIndex === request.lines.length - 1
          ? 'Close'
          : 'Continue'
        : 'Continue';
    drawText(ctx, `[Space / Click] ${label}`, {
      x: boxRect.x + boxRect.width - FOOTER_PAD_X,
      y: footerY,
      size: FOOTER_HINT_SIZE,
      color: FOOTER_HINT_COLOR,
      align: 'right',
    });
  }

  private renderFooterButton(
    ctx: CanvasRenderingContext2D,
    label: string,
    boxRect: { x: number; y: number; width: number; height: number },
    footerY: number,
  ): void {
    ctx.save();
    ctx.font = `${CONVERSATION_CHOICE_LABEL_SIZE}px sans-serif`;
    const labelWidth = ctx.measureText(`1. ${label}`).width;
    ctx.restore();
    const width = Math.max(
      FOOTER_BUTTON_MIN_WIDTH,
      Math.min(FOOTER_BUTTON_MAX_WIDTH, labelWidth + FOOTER_BUTTON_LABEL_PADDING),
    );
    const x = boxRect.x + boxRect.width - FOOTER_PAD_X - width;
    const y = footerY - FOOTER_BUTTON_HEIGHT + FOOTER_HINT_SIZE;
    drawButton(ctx, {
      x,
      y,
      width,
      height: FOOTER_BUTTON_HEIGHT,
      label: `1. ${label}`,
      ...BUTTON_PRESETS.primary,
      labelSize: CONVERSATION_CHOICE_LABEL_SIZE,
      primaryAction: true,
    });
    this.footerButtonRect = { x, y, w: width, h: FOOTER_BUTTON_HEIGHT };
  }

  private renderChoiceRow(
    ctx: CanvasRenderingContext2D,
    boxRect: { x: number; y: number; width: number; height: number },
    haltsWorld: boolean,
  ): void {
    const choices = this.currentChoiceRow();
    if (haltsWorld) beginMenuFocus(FOCUS_CONTEXT);

    const fitsInRow = Math.floor(
      (boxRect.width + CHOICE_BUTTON_GAP) / (MIN_CHOICE_BUTTON_WIDTH + CHOICE_BUTTON_GAP),
    );
    const rowPitch = CHOICE_BUTTON_HEIGHT + CHOICE_BUTTON_GAP;
    const boxBottom = boxRect.y + boxRect.height;
    const rowsOnScreen = Math.max(
      1,
      Math.floor((boxBottom - CHOICES_MIN_TOP + CHOICE_BUTTON_GAP) / rowPitch),
    );
    let perRow = Math.max(1, Math.min(MAX_CHOICES_PER_ROW, fitsInRow, choices.length));
    while (Math.ceil(choices.length / perRow) > rowsOnScreen && perRow < choices.length) {
      perRow++;
    }
    const rowCount = Math.ceil(choices.length / perRow);
    const buttonWidth = Math.min(
      CHOICE_BUTTON_WIDTH,
      (boxRect.width - (perRow - 1) * CHOICE_BUTTON_GAP) / perRow,
    );
    const stackedFromBox =
      boxRect.y - CHOICE_ROW_GAP - CHOICE_BUTTON_HEIGHT - (rowCount - 1) * rowPitch;
    const firstRowY = Math.max(CHOICES_MIN_TOP, stackedFromBox);

    choices.forEach((choice, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const inThisRow = Math.min(perRow, choices.length - row * perRow);
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
        ...(choice.tone === 'exit' ? BUTTON_PRESETS.primary : BUTTON_PRESETS.villagerTopic),
        labelSize: CONVERSATION_CHOICE_LABEL_SIZE,
        primaryAction:
          this.ending.kind === 'confirm'
            ? this.isConfirmPrimaryIndex(index)
            : choice.tone === 'exit',
        questRelated: choice.tone === 'quest',
      });
      this.choiceRects.push({ index, x, y, w: buttonWidth, h: CHOICE_BUTTON_HEIGHT, label });
    });

    if (haltsWorld) endMenuFocus();
  }

  private rewardTextWidth(stripWidth: number): number {
    return stripWidth - REWARD_STRIP_PAD * 2 - REWARD_ICON_SIZE - REWARD_ICON_TEXT_GAP;
  }

  private rewardStripHeight(
    ctx: CanvasRenderingContext2D,
    reward: DialogReward,
    stripWidth: number,
  ): number {
    const { lineCount } = measureTextBox(ctx, reward.lines.join('\n'), {
      width: this.rewardTextWidth(stripWidth),
      size: REWARD_LINE_SIZE,
      lineHeight: REWARD_LINE_SPACING,
    });
    const textHeight =
      REWARD_HEADING_HEIGHT +
      REWARD_NAME_HEIGHT +
      lineCount * REWARD_LINE_SPACING +
      (reward.xp > 0 ? REWARD_XP_HEIGHT : 0);
    return REWARD_STRIP_PAD * 2 + Math.max(REWARD_ICON_SIZE, textHeight);
  }

  private renderRewardStrip(
    ctx: CanvasRenderingContext2D,
    reward: DialogReward,
    boxRect: { x: number; y: number; width: number; height: number },
  ): void {
    const width = boxRect.width;
    const height = this.rewardStripHeight(ctx, reward, width);
    const x = boxRect.x;
    const y = boxRect.y + boxRect.height + REWARD_STRIP_TOP_GAP;
    drawBox(ctx, { x, y, width, height, ...BOX_PRESETS.panel });

    const innerX = x + REWARD_STRIP_PAD;
    const innerY = y + REWARD_STRIP_PAD;
    const itemId: ItemId = reward.itemId;
    drawItemIcon(ctx, { ...ITEM_DEF[itemId], quantity: 1 }, innerX, innerY, REWARD_ICON_SIZE);

    const textX = innerX + REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
    const textWidth = this.rewardTextWidth(width);
    drawText(ctx, REWARD_HEADING_TEXT, {
      x: textX,
      y: innerY,
      size: REWARD_HEADING_SIZE,
      bold: true,
      color: REWARD_HEADING_COLOR,
    });
    drawText(ctx, reward.displayName, {
      x: textX,
      y: innerY + REWARD_HEADING_HEIGHT,
      size: REWARD_NAME_SIZE,
      bold: true,
      color: REWARD_NAME_COLOR,
    });
    const linesY = innerY + REWARD_HEADING_HEIGHT + REWARD_NAME_HEIGHT;
    drawText(ctx, reward.lines.join('\n'), {
      x: textX,
      y: linesY,
      width: textWidth,
      lineHeight: REWARD_LINE_SPACING,
      size: REWARD_LINE_SIZE,
      color: REWARD_LINE_COLOR,
    });
    if (reward.xp > 0) {
      const { lineCount } = measureTextBox(ctx, reward.lines.join('\n'), {
        width: textWidth,
        size: REWARD_LINE_SIZE,
        lineHeight: REWARD_LINE_SPACING,
      });
      drawText(ctx, `+${reward.xp} XP`, {
        x: textX,
        y: linesY + lineCount * REWARD_LINE_SPACING,
        size: REWARD_XP_SIZE,
        bold: true,
        color: REWARD_XP_COLOR,
      });
    }
  }

  /**
   * This conversation's claim on the screen: `haltsWorld` and `focusContext`
   * both read straight off the active request, so a scene's `update()` and
   * the focus ring this panel draws can never drift from what it actually
   * does. `null` while nothing is open, so a caller with several possible
   * conversation owners can just spread every one of them into its claim
   * list and let `isOpen: false` make the unused ones inert.
   */
  overlayClaim(): OverlayInputClaim {
    const request = this.request;
    const haltsWorld = request?.haltsWorld ?? false;
    return {
      isOpen: request !== null,
      space: { kind: 'advance', advance: () => this.advance() },
      locksKeyboard: request?.locksKeyboard ?? false,
      haltsWorld,
      focusContext: haltsWorld ? FOCUS_CONTEXT : null,
    };
  }
}
