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
 * — on a choice or confirm row — takes the row's default, which is the
 * accepting option and never a way out (see `defaultChoiceIndex`). Escape is
 * the only key that leaves.
 *
 * The box and everything drawn against it are laid out in canvas CSS pixels,
 * the space the box paginates in, and painted under the inverse of the UI
 * scale; their hit regions are registered in UI units.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import { TILE_SIZE } from '../core/constants';
import { keybindings } from '../core/Keybindings';
import { viewportHeight } from '../core/Viewport';
import { countDisplayPages, DialogBox } from '../ui/DialogBox';
import {
  ACTIVATE_KEYS,
  FOCUS_MOVE_KEYS,
  UI_TAP_SOUND,
  type Band,
  type HitHandlers,
  type HitState,
  type KeyModifiers,
  type Surface,
  type TapEvent,
  type Ui,
} from '../ui/core/UiRoot';
import type { Rect } from '../ui/core/geom';
import type { DialogLine, NonEmpty } from './line';
import {
  drawChoiceButton,
  drawFooterButton,
  drawFooterHint,
  drawRewardStrip,
  footerButtonNaturalWidth,
  footerHintHeight,
  rewardStripHeight,
  type RewardStripSize,
} from '../ui/screens/dialogs/conversationChrome';
import type { PaintTarget } from '../ui/widgets/paint';
import { resolveSpeaker, speakerTypeface } from './speakers';
import type {
  Choice,
  ConfirmKeyboardDefault,
  ConversationAnchor,
  ConversationHandle,
  ConversationRequest,
  DialogReward,
  Ending,
  PendingLine,
} from './request';
import { walkAwayRangeTiles } from './walkAway';

type Beat = DialogLine | PendingLine;

function isPendingLine(beat: Beat): beat is PendingLine {
  return !('paragraphs' in beat);
}

/** How far the player stands from the speaker `anchor` names, in tiles, measured between their positions as the talk checks measure it. */
function speakerDistanceTiles(
  anchor: ConversationAnchor,
  playerPosition: { readonly x: number; readonly y: number },
): number {
  const speakerPosition = anchor.position();
  const dx = playerPosition.x - speakerPosition.x;
  const dy = playerPosition.y - speakerPosition.y;
  return Math.hypot(dx, dy) / TILE_SIZE;
}

/** A single-page "…" line, shown while a `PendingLine`'s text is still in flight. */
const PENDING_PLACEHOLDER: NonEmpty<string> = ['…'];

/** Shown in place of a `PendingLine` whose promise rejected, so a failed fetch still ends in a readable page rather than a permanent "…". */
const PENDING_LINE_FAILURE_TEXT = "…that didn't come through. Try asking again.";

const CHOICE_BUTTON_WIDTH = 200;
const MIN_CHOICE_BUTTON_WIDTH = 160;
const CHOICE_BUTTON_HEIGHT = 36;
const CHOICE_BUTTON_GAP = 8;
const CHOICE_ROW_GAP = 8;
const MAX_CHOICES_PER_ROW = 3;
const CHOICES_MIN_TOP = 8;
const MAX_NUMBERED_CHOICES = 9;
/** Leads the selected choice's label, so selection survives a screenshot in greyscale or a colour-blind eye. */
const SELECTED_CHOICE_MARKER = '▶ ';

const FOOTER_PAD_X = 14;
const FOOTER_Y_FROM_BOTTOM = 18;
/** How far below the footer row's top the custom-advance button's bottom edge sits. */
const FOOTER_BUTTON_DROP = 10;
const FOOTER_BUTTON_HEIGHT = 22;
const FOOTER_BUTTON_MIN_WIDTH = 90;
const FOOTER_BUTTON_MAX_WIDTH = 220;

const REWARD_STRIP_TOP_GAP = 12;
/** Strip sizes tried in order until one fits beside the box. */
const REWARD_STRIP_SIZES: readonly RewardStripSize[] = ['full', 'compact'];

/** Whether a canvas point lies on `rect`, its far edges included, the way every press on the box is tested. */
function touches(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * `rect`, in canvas CSS pixels, as a hit rect in UI units. Rounded outward
 * with the far edges included: `handleClick` takes a rect's edge pixels, and a
 * press there must not fall through to the world.
 */
function toUiRect(rect: Rect, uiScale: number): Rect {
  const left = Math.floor(rect.x / uiScale);
  const top = Math.floor(rect.y / uiScale);
  return {
    x: left,
    y: top,
    w: Math.floor((rect.x + rect.w) / uiScale) + 1 - left,
    h: Math.floor((rect.y + rect.h) / uiScale) + 1 - top,
  };
}

/** The region id of choice `index` on row `rowSerial`: a fresh id per row, so focus walked onto one row never carries to the next. */
function choiceRegionId(rowSerial: number, index: number): string {
  return `row${rowSerial}/choice${index}`;
}

/**
 * The index a bare Space picks on a `choices` row, or null when it picks nothing.
 *
 * A choice that names itself the default wins. Otherwise the first quest
 * choice, then the first ordinary one — the option that carries the
 * conversation forward. A way out (`tone: 'exit'`) is picked only when the row
 * holds nothing else, since then there is nothing for it to decline.
 * A choice marked `keyboard: 'never'` is never picked.
 */
export function defaultChoiceIndex(choices: readonly Choice[]): number | null {
  const pickable = (choice: Choice): boolean => choice.keyboard !== 'never';
  const firstWhere = (matches: (choice: Choice) => boolean): number | null => {
    const index = choices.findIndex((choice) => pickable(choice) && matches(choice));
    return index === -1 ? null : index;
  };
  const rowIsOnlyWaysOut = choices.every((choice) => choice.tone === 'exit');
  return (
    firstWhere((choice) => choice.keyboard === 'default') ??
    firstWhere((choice) => choice.tone === 'quest') ??
    firstWhere((choice) => choice.tone === 'normal') ??
    (rowIsOnlyWaysOut ? firstWhere(() => true) : null)
  );
}

/** A choice button where the last frame drew it, in canvas CSS pixels. */
export interface PlacedChoice extends Rect {
  readonly index: number;
  /** The label as drawn, number included. */
  readonly label: string;
}

/** What the conversation's surface is told by the scene mounting it. */
export interface ConversationSurfaceOptions {
  readonly id?: string;
  /**
   * Tried first on Space: lets the press go to the world instead (the player
   * has walked off, or is pressing at someone else). Returns whether the
   * world took it.
   */
  readonly handOffPress?: () => boolean;
  /** What Escape does; `dismiss()` when omitted. */
  readonly dismiss?: () => void;
  /** When it returns false, Escape passes beneath. */
  readonly wantsEscape?: () => boolean;
  /**
   * A press off the box while a halting request covers the screen, in canvas
   * CSS pixels, for the few HUD controls that stay live under it.
   */
  readonly offBoxClick?: (x: number, y: number) => void;
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
  /**
   * Bumped every time a choice or confirm row comes up, so each row's buttons
   * register under ids of their own: a player who tabbed off the default on
   * one row starts the next on its default again.
   */
  private choiceRowSerial = 0;
  private choiceRects: PlacedChoice[] = [];
  private drawnSelectedIndex: number | null = null;
  /**
   * Which row was last drawn, and the choice the pointer was over then (null
   * for none). Hover moves keyboard focus only when the pointer moves onto a
   * choice of a row already on screen. A cursor that merely happens to lie
   * where a new row draws a button has not aimed at it — on a row whose
   * Space does nothing, like a fee, taking focus there would let Space pay —
   * and a cursor left resting on one option must not drag focus back after an
   * arrow key moves it.
   */
  private lastPointerOverRow: { readonly rowSerial: number; readonly index: number | null } | null =
    null;
  /** The last row whose default was handed keyboard focus as it came up. */
  private focusSeededRow: number | null = null;
  /**
   * The choice the row last drew as selected. A press anywhere hides the
   * focus ring, but a click past the box (a HUD button live under the
   * conversation) has not chosen anything, so the selection holds.
   */
  private heldSelection: { readonly rowSerial: number; readonly index: number } | null = null;
  private footerButtonRect: Rect | null = null;
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
  get choiceBounds(): ReadonlyArray<PlacedChoice> {
    return this.choiceRects;
  }

  /** Which choice the last frame drew as selected — the one wearing the marker — or null when none was. */
  get selectedChoiceIndex(): number | null {
    return this.drawnSelectedIndex;
  }

  /** The labels of the choices on offer, in their numbered order — empty while nothing is up to choose from. */
  get choiceLabels(): readonly string[] {
    return this.currentChoiceRow().map((choice) => choice.label);
  }

  /** The label a bare Space would pick on the row now up, or null when Space picks nothing there. */
  get keyboardDefaultLabel(): string | null {
    const index = this.keyboardDefaultIndex();
    if (index === null) return null;
    return this.currentChoiceRow()[index]?.label ?? null;
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
        this.choiceRowSerial++;
        this.ending = { kind: 'choices', choices: ending.choices };
        return;
      case 'confirm':
        this.choiceRowSerial++;
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
    if (speakerDistanceTiles(anchor, playerPosition) <= walkAwayRangeTiles(anchor.talkRangeTiles)) {
      return;
    }
    const onDismissed = request.dismiss.onDismissed;
    this.doClose();
    onDismissed();
  }

  /**
   * Offers an interact press to the world instead of to this box, once the
   * player has stepped out of the speaker's talk range — or, with
   * `pressIsForSomeoneElse`, when the scene knows the press is aimed at a
   * different speaker whose range overlaps this one's.
   *
   * Between leaving the talk range and reaching the walk-away range the box
   * is still up to be read, but the player could no longer open it from where
   * they stand, so a press there is meant for whoever they have walked up to.
   * Handing it on is what lets the player turn from one speaker straight to
   * the next without the stale box taking the key.
   *
   * `interact` is the scene's own interaction chain; it returns whether
   * anything took the press. When it opened a new conversation, `open()` has
   * already dismissed this one; when it took the press some other way — a
   * shop panel, a pickup — this one is dismissed here, exactly as walking the
   * rest of the way off would have. When nothing took it, the box keeps the
   * press as usual and nothing changes.
   *
   * Only an `allowed`, anchored request is ever handed off: a `blocked` one is
   * a scene the player is being held for.
   *
   * @returns whether the world took the press.
   */
  handOff(
    playerPosition: { readonly x: number; readonly y: number },
    pressIsForSomeoneElse: boolean,
    interact: () => boolean,
  ): boolean {
    const request = this.request;
    if (request?.dismiss.kind !== 'allowed') return false;
    const anchor = request.anchor;
    if (anchor === null) return false;
    const outOfTalkRange = speakerDistanceTiles(anchor, playerPosition) > anchor.talkRangeTiles;
    if (!outOfTalkRange && !pressIsForSomeoneElse) return false;
    const generationBefore = this.generation;
    if (!interact()) return false;
    const stillShowingThisSpeaker = this.generation === generationBefore && this.request !== null;
    if (stillShowingThisSpeaker) this.dismiss();
    return true;
  }

  /** Whether a click or tap at this point would land on the box, its choice row or its footer button. */
  hitsSurface(mx: number, my: number): boolean {
    if (this.request === null) return false;
    const inside = (rect: { x: number; y: number; w: number; h: number }): boolean =>
      mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
    if (this.choiceRects.some(inside)) return true;
    if (this.footerButtonRect !== null && inside(this.footerButtonRect)) return true;
    return this.box.contains(mx, my);
  }

  /** Space, or a tap on the box: skip the typing, turn the page, activate a custom-advance button, or take the choice/confirm row's default. */
  advance(): void {
    const request = this.request;
    if (request === null) return;
    if (this.isLineStillPending(request, this.lineIndex)) return;
    if (!this.box.isFullyRevealed()) {
      this.box.skipToEnd();
      return;
    }
    if (this.ending.kind === 'choices' || this.ending.kind === 'confirm') {
      // A row the player has not yet been shown cannot have been answered:
      // the press that finished the last page must not also pick from the
      // row that page opens onto.
      if (!this.choiceRowRendered) return;
      const index = this.keyboardDefaultIndex();
      const picked = index === null ? undefined : this.currentChoiceRow()[index];
      if (picked !== undefined) this.runChoice(picked);
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
    this.audio?.play(UI_TAP_SOUND);
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

  /** What a click or tap can land on, in canvas CSS pixels: the box, its choice row and its footer button. Empty while closed. */
  hitRects(): Rect[] {
    if (this.request === null) return [];
    const rects: Rect[] = [this.box.rect()];
    for (const { x, y, w, h } of this.choiceRects) rects.push({ x, y, w, h });
    if (this.footerButtonRect !== null) rects.push(this.footerButtonRect);
    return rects;
  }

  /**
   * The conversation as a surface, its claim read off the active request each
   * time it is asked. A request that halts the world sits with the modals and
   * covers the screen, and its choice row is the keyboard focus ring; one the
   * player can walk away from floats over the HUD, takes only presses on its
   * own box, and leaves the arrow keys to walking.
   */
  surface(opts: ConversationSurfaceOptions = {}): Surface {
    const halts = (): boolean => this.request?.haltsWorld === true;
    const locks = (): boolean => this.request?.locksKeyboard === true;
    const surface: Surface = {
      id: opts.id ?? 'conversation',
      get band(): Band {
        return halts() ? 'modal' : 'panel';
      },
      get haltsWorld(): boolean {
        return halts();
      },
      get locksKeyboard(): boolean {
        return locks();
      },
      isOpen: () => this.isOpen,
      render: (ui) => this.renderSurface(ui, opts.offBoxClick),
      onKey: (key, mods) => this.surfaceKey(key, mods, opts.handOffPress),
      close: opts.dismiss ?? (() => void this.dismiss()),
    };
    const wantsEscape = opts.wantsEscape;
    if (wantsEscape !== undefined) surface.wantsEscape = () => wantsEscape();
    return surface;
  }

  /**
   * A key offered to the surface. Digits pick; on a world-halting row the
   * focus keys are left to the row's focus ring; the attack key (Space unless
   * rebound) is otherwise the advance, once per fresh press.
   */
  private surfaceKey(
    key: string,
    mods: KeyModifiers,
    handOffPress: (() => boolean) | undefined,
  ): boolean {
    if (this.handleKeyDown(key)) return true;
    const rowOwnsFocusKeys = this.request?.haltsWorld === true && this.ending.kind !== 'none';
    if (rowOwnsFocusKeys && (ACTIVATE_KEYS.has(key) || FOCUS_MOVE_KEYS.has(key))) return false;
    if (keybindings.actionFor(key) !== 'attack') return false;
    const freshPress = mods.repeat !== true && mods.predatesSurface !== true;
    if (freshPress && handOffPress?.() !== true) this.advance();
    return true;
  }

  /** A click or tap, in canvas CSS pixels. Returns whether it landed on this conversation. */
  handleClick(mx: number, my: number): boolean {
    if (this.request === null) return false;
    if (this.ending.kind === 'choices' || this.ending.kind === 'confirm') {
      for (const rect of this.choiceRects) {
        if (touches(rect, mx, my)) {
          this.runChoice(this.currentChoiceRow()[rect.index]);
          return true;
        }
      }
    }
    if (this.footerButtonRect !== null && touches(this.footerButtonRect, mx, my)) {
      this.advance();
      return true;
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
   * Which entry of `currentChoiceRow()` a bare Space picks, or null for none.
   * A confirm row is ordered `[decline, accept]` and only ever defaults to
   * its accept side.
   */
  private keyboardDefaultIndex(): number | null {
    if (this.ending.kind === 'choices') return defaultChoiceIndex(this.ending.choices);
    if (this.ending.kind === 'confirm') {
      const confirmAcceptIndex = 1;
      return this.ending.keyboardDefault === 'accept' ? confirmAcceptIndex : null;
    }
    return null;
  }

  /** The active line and every line still to come, for the "n / N" indicator across the whole request. */
  private displayPageTotals(request: ConversationRequest): { current: number; total: number } {
    let total = 0;
    let current = 0;
    request.lines.forEach((line, index) => {
      const pages = isPendingLine(line)
        ? 1
        : countDisplayPages(line.paragraphs, false, speakerTypeface(line.speaker));
      if (index < this.lineIndex) current += pages;
      else if (index === this.lineIndex) current += this.box.currentPageNumber();
      total += pages;
    });
    return { current, total };
  }

  private renderSurface(ui: Ui, offBoxClick: ((x: number, y: number) => void) | undefined): void {
    const request = this.request;
    if (request === null) return;
    const scale = ui.uiScale;
    const boxRect = this.box.rect();
    const rowUp = this.ending.kind !== 'none';
    this.choiceRects = rowUp ? this.placeChoices(boxRect) : [];
    this.drawnSelectedIndex = null;
    this.footerButtonRect = this.placeFooterButton(ui, request, boxRect);
    if (rowUp) this.choiceRowRendered = true;

    const tap = (e: TapEvent): void => {
      const x = e.x * scale;
      const y = e.y * scale;
      if (!this.handleClick(x, y)) offBoxClick?.(x, y);
    };
    const pressable = (sound: SoundId | null): HitHandlers => ({
      onTap: tap,
      focusable: false,
      sound,
    });
    if (request.haltsWorld) ui.hit('off-box', ui.screen, pressable(null));
    ui.hit('box', toUiRect(boxRect, scale), pressable(null));
    const footerButton = this.footerButtonRect;
    const footerState =
      footerButton === null
        ? null
        : ui.hit('advance', toUiRect(footerButton, scale), pressable(UI_TAP_SOUND));
    const row = rowUp ? this.registerChoiceRow(ui, request.haltsWorld, tap) : null;

    const { ctx } = ui;
    ctx.save();
    ctx.scale(1 / scale, 1 / scale);
    this.box.render(ctx);
    this.renderFooter(ui, request, boxRect, footerState);
    if (row !== null) {
      this.paintChoiceRow(ui, request.haltsWorld, row);
    } else {
      const isLastLine = this.lineIndex === request.lines.length - 1;
      const onLastPage =
        !this.isLineStillPending(request, this.lineIndex) &&
        this.box.isLastPageOfLine() &&
        this.box.isFullyRevealed();
      if (isLastLine && onLastPage && request.reward !== null) {
        this.renderRewardStrip(ui, request.reward, boxRect);
      }
    }
    ctx.restore();
  }

  private footerRow(target: PaintTarget, boxRect: Rect, footerY: number): Rect {
    return {
      x: boxRect.x + FOOTER_PAD_X,
      y: footerY,
      w: boxRect.w - FOOTER_PAD_X * 2,
      h: footerHintHeight(target.theme),
    };
  }

  /** The label a line with a custom advance shows on its button, once its last page is read; null for none. */
  private customAdvanceLabel(request: ConversationRequest): string | null {
    if (this.ending.kind !== 'none') return null;
    if (this.isLineStillPending(request, this.lineIndex)) return null;
    const line = request.lines[this.lineIndex];
    const onLastPageOfLine = this.box.isLastPageOfLine() && this.box.isFullyRevealed();
    if (isPendingLine(line) || !onLastPageOfLine || line.advance.kind !== 'custom') return null;
    return `1. ${line.advance.label}`;
  }

  private placeFooterButton(
    target: PaintTarget,
    request: ConversationRequest,
    boxRect: Rect,
  ): Rect | null {
    const label = this.customAdvanceLabel(request);
    if (label === null) return null;
    const width = Math.max(
      FOOTER_BUTTON_MIN_WIDTH,
      Math.min(FOOTER_BUTTON_MAX_WIDTH, footerButtonNaturalWidth(target, label)),
    );
    const footerY = boxRect.y + boxRect.h - FOOTER_Y_FROM_BOTTOM;
    return {
      x: boxRect.x + boxRect.w - FOOTER_PAD_X - width,
      y: footerY - FOOTER_BUTTON_HEIGHT + FOOTER_BUTTON_DROP,
      w: width,
      h: FOOTER_BUTTON_HEIGHT,
    };
  }

  private renderFooter(
    ui: Ui,
    request: ConversationRequest,
    boxRect: Rect,
    footerState: HitState | null,
  ): void {
    const footerY = boxRect.y + boxRect.h - FOOTER_Y_FROM_BOTTOM;
    const row = this.footerRow(ui, boxRect, footerY);
    const { current, total } = this.displayPageTotals(request);
    if (total > 1) drawFooterHint(ui, row, `${current} / ${total}`, 'left');

    if (this.ending.kind !== 'none') {
      this.renderRowFooterHint(ui, request, row);
      return;
    }
    if (this.isLineStillPending(request, this.lineIndex)) return;

    const buttonLabel = this.customAdvanceLabel(request);
    const button = this.footerButtonRect;
    if (buttonLabel !== null && button !== null && footerState !== null) {
      drawFooterButton(ui, button, buttonLabel, footerState);
      return;
    }

    const onLastPageOfLine = this.box.isLastPageOfLine() && this.box.isFullyRevealed();
    const label = !this.box.isFullyRevealed()
      ? 'Skip'
      : onLastPageOfLine
        ? this.lineIndex === request.lines.length - 1
          ? 'Close'
          : 'Continue'
        : 'Continue';
    drawFooterHint(ui, row, `[Space / Click] ${label}`, 'right');
  }

  /**
   * Names what Space will pick on a row with no focus ring to show it — a
   * street conversation, whose arrow keys still walk. A world-halting row
   * draws its default as the focused button instead.
   */
  private renderRowFooterHint(target: PaintTarget, request: ConversationRequest, row: Rect): void {
    if (request.haltsWorld) return;
    const label = this.keyboardDefaultLabel;
    if (label === null) return;
    drawFooterHint(target, row, `[Space] ${label}`, 'right');
  }

  /** Lays the choice or confirm row out above the box, wrapping onto as many rows as the screen above it allows. */
  private placeChoices(boxRect: Rect): PlacedChoice[] {
    const choices = this.currentChoiceRow();
    const fitsInRow = Math.floor(
      (boxRect.w + CHOICE_BUTTON_GAP) / (MIN_CHOICE_BUTTON_WIDTH + CHOICE_BUTTON_GAP),
    );
    const rowPitch = CHOICE_BUTTON_HEIGHT + CHOICE_BUTTON_GAP;
    const boxBottom = boxRect.y + boxRect.h;
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
      (boxRect.w - (perRow - 1) * CHOICE_BUTTON_GAP) / perRow,
    );
    const stackedFromBox =
      boxRect.y - CHOICE_ROW_GAP - CHOICE_BUTTON_HEIGHT - (rowCount - 1) * rowPitch;
    const firstRowY = Math.max(CHOICES_MIN_TOP, stackedFromBox);

    return choices.map((choice, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const inThisRow = Math.min(perRow, choices.length - row * perRow);
      const rowWidth = inThisRow * buttonWidth + (inThisRow - 1) * CHOICE_BUTTON_GAP;
      const numbered = index < MAX_NUMBERED_CHOICES;
      return {
        index,
        x: boxRect.x + (boxRect.w - rowWidth) / 2 + column * (buttonWidth + CHOICE_BUTTON_GAP),
        y: firstRowY + row * rowPitch,
        w: buttonWidth,
        h: CHOICE_BUTTON_HEIGHT,
        label: numbered ? `${index + 1}. ${choice.label}` : choice.label,
      };
    });
  }

  /**
   * Registers the row's buttons and decides which one wears the selected
   * look, which always marks what Space will take. On a world-halting row
   * that is the focus ring's entry, which starts on the row's default and
   * follows the pointer; a row without a ring always takes its fixed default.
   */
  private registerChoiceRow(
    ui: Ui,
    haltsWorld: boolean,
    tap: (e: TapEvent) => void,
  ): { readonly states: readonly HitState[]; readonly selectedIndex: number | null } {
    const serial = this.choiceRowSerial;
    const defaultIndex = this.keyboardDefaultIndex();
    if (haltsWorld && this.focusSeededRow !== serial) {
      this.focusSeededRow = serial;
      if (defaultIndex !== null) ui.focus(choiceRegionId(serial, defaultIndex));
    }
    const scale = ui.uiScale;
    const states = this.choiceRects.map((placed) =>
      ui.hit(choiceRegionId(serial, placed.index), toUiRect(placed, scale), {
        onTap: tap,
        focusable: haltsWorld,
        primary: haltsWorld && placed.index === defaultIndex,
        sound: null,
      }),
    );

    const pointer = ui.pointer;
    const hovered =
      pointer === null
        ? undefined
        : this.choiceRects.find((placed) => touches(placed, pointer.x * scale, pointer.y * scale));
    const hoveredIndex = hovered?.index ?? null;
    const lastPointer = this.lastPointerOverRow;
    const rowWasAlreadyOnScreen = lastPointer?.rowSerial === serial;
    const pointerMovedOntoChoice =
      rowWasAlreadyOnScreen && hoveredIndex !== null && lastPointer.index !== hoveredIndex;
    this.lastPointerOverRow = { rowSerial: serial, index: hoveredIndex };

    if (!haltsWorld) return { states, selectedIndex: defaultIndex };
    const select = (index: number | null) => {
      this.heldSelection = index === null ? null : { rowSerial: serial, index };
      return { states, selectedIndex: index };
    };
    if (pointerMovedOntoChoice) {
      ui.focus(choiceRegionId(serial, hoveredIndex));
      return select(hoveredIndex);
    }
    const focusedIndex = states.findIndex((state) => state.focused);
    if (focusedIndex !== -1) return select(focusedIndex);
    const held = this.heldSelection;
    if (held !== null && held.rowSerial === serial) {
      ui.focus(choiceRegionId(serial, held.index));
      return select(held.index);
    }
    return select(defaultIndex);
  }

  private paintChoiceRow(
    ui: Ui,
    haltsWorld: boolean,
    row: { readonly states: readonly HitState[]; readonly selectedIndex: number | null },
  ): void {
    const choices = this.currentChoiceRow();
    const serial = this.choiceRowSerial;
    this.drawnSelectedIndex = row.selectedIndex;
    this.choiceRects = this.choiceRects.map((placed) => {
      const isSelected = placed.index === row.selectedIndex;
      const label = isSelected ? `${SELECTED_CHOICE_MARKER}${placed.label}` : placed.label;
      drawChoiceButton(ui, placed, {
        id: choiceRegionId(serial, placed.index),
        label,
        tone: choices[placed.index].tone,
        selected: isSelected,
        hoverable: !haltsWorld,
        state: row.states[placed.index],
      });
      return { ...placed, label };
    });
  }

  private renderRewardStrip(target: PaintTarget, reward: DialogReward, boxRect: Rect): void {
    const width = boxRect.w;
    const placed = REWARD_STRIP_SIZES.map((size) => {
      const height = rewardStripHeight(target, reward, width, size);
      const belowY = boxRect.y + boxRect.h + REWARD_STRIP_TOP_GAP;
      const aboveY = boxRect.y - REWARD_STRIP_TOP_GAP - height;
      const lowestY = viewportHeight() - REWARD_STRIP_TOP_GAP - height;
      const y = belowY <= lowestY ? belowY : aboveY >= 0 ? aboveY : null;
      return { size, height, y, aboveY };
    });
    // The strip never covers the box: its footer holds the close hint and any
    // custom-advance button. Failing every size beside it, the compact strip
    // is pinned to the top of the screen, over the speaker row at worst.
    const fitting = placed.find((placement) => placement.y !== null);
    const compact = placed[placed.length - 1];
    const size = fitting?.size ?? compact.size;
    const height = fitting?.height ?? compact.height;
    const y = fitting?.y ?? Math.max(0, compact.aboveY);
    drawRewardStrip(target, reward, { x: boxRect.x, y, w: width, h: height }, size);
  }
}
