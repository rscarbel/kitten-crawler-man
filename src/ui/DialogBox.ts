/**
 * Reusable chat-style dialog box. Shows a speaker's name, portrait and voice
 * — resolved by the caller and handed to `show()` — and paginates its own
 * body text lazily, against the live viewport, the first time anything asks
 * for page state (not only at render, so a caller that advances the line
 * before ever drawing it — a headless test, or input handled the same frame
 * a conversation opens — still gets a real answer).
 *
 * Typical usage:
 *   1. Construct once, passing the scene's AudioManager.
 *   2. Call show(paragraphs, speaker) to begin a line.
 *   3. Call update() each frame.
 *   4. Call render() each frame.
 *   5. On space/click: if isFullyRevealed(): if isLastPageOfLine(), close or
 *      move on; else advancePage(). Otherwise call skipToEnd().
 */

import { drawBox } from './Box';
import { drawText, measureTextBox } from './TextBox';
import { drawQuestIcon } from './QuestIcon';
import type { AudioManager } from '../audio/AudioManager';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { allocCanvas, surfaceContext } from '../core/canvasSurface';
import type { Paragraphs } from '../dialog/line';
import { paginate, splitSentences, type Page } from '../dialog/paginate';
import type { SpeakerVoice, TextCase } from '../dialog/speakers';

let measuringCtx: CanvasRenderingContext2D | null = null;

/**
 * A tiny off-screen context used only to measure text for pagination.
 * Deliberately not the context `render()` draws with: font metrics don't
 * depend on which canvas asks for them, and computing pages needs to work
 * before a real one is ever handed to this box.
 */
function measuringContext(): CanvasRenderingContext2D {
  measuringCtx ??= surfaceContext(allocCanvas(1, 1));
  return measuringCtx;
}

// Layout geometry
const DIALOG_MAX_WIDTH = 560;
const DIALOG_HEIGHT = 175;
const DIALOG_SIDE_MARGIN = 20;
const GAP_ABOVE_HOTBAR = 8;
const DIALOG_PADDING = 14;
/**
 * Floor on the box's top edge. A short viewport — a phone in landscape is barely
 * 400px — would otherwise push the box off the top of the canvas entirely,
 * silently swallowing whatever it was there to say.
 */
const DIALOG_MIN_TOP = 8;
const HOTBAR_SLOT_SIZE = 52;
const HOTBAR_BOTTOM_MARGIN = 12;

// Content positions relative to the dialog's top-left
const SPEAKER_ROW_Y = 10;
const ICON_SIZE = 20;
const ICON_GAP = 8;
const TEXT_AREA_Y = 34;
const TEXT_SIZE = 12;
const TEXT_LINE_HEIGHT = 18;
const SPEAKER_SIZE = 13;
const FOOTER_HINT_SIZE = 10;
const FOOTER_Y_FROM_BOTTOM = 18;
const BORDER_RADIUS = 4;
const TEXT_AREA_BOTTOM_GAP = 4;
const QUEST_ICON_SIZE = 16;
const QUEST_ICON_MARGIN = 10;

// Colors — warm parchment/candlelight theme matching Mordecai's tutorial dialog
const DIALOG_BG = 'rgba(10,8,6,0.92)';
const BORDER_COLOR = '#c8a860';
const BORDER_WIDTH = 2;
const TEXT_COLOR = '#e8dfc8';
const SPEAKER_COLOR = '#c8a860';
const HINT_COLOR = '#7a6e5a';

/** Controls how the dialog body text is progressively revealed. */
export type RevealMode = 'all' | 'sentence' | 'word' | 'letter';

/** The speaker of the line now showing, resolved from a `SpeakerRef` — a portrait already painted, not a lookup key. */
export interface ResolvedSpeaker {
  /** `null` renders a nameless speaker row. */
  readonly name: string | null;
  readonly portrait: CanvasImageSource | null;
  readonly voice: SpeakerVoice;
  readonly reveal: RevealMode;
  readonly textCase: TextCase;
  /** Milliseconds between revealed elements — this speaker's own pace, not a box-wide setting. */
  readonly revealIntervalMs: number;
}

export interface DialogBoxConfig {
  /**
   * Whether to render the Skip / Continue footer hint. False for dialogs that
   * auto-dismiss and have no user interaction.
   */
  readonly showFooterHint: boolean;
}

/** Options passed to show() to configure per-line behaviour. */
export interface ShowOptions {
  /**
   * Shows the shared quest badge in the box's top-right corner. Set when the
   * conversation on screen matters for an active quest but offers the player
   * no choice — a choice that matters wears the badge itself instead (see
   * {@link ButtonOptions.questRelated}).
   */
  readonly questRelated: boolean;
  /**
   * Read every render to draw the footer's "n / N" counter, or nothing when
   * it returns `null`. A callback rather than a fixed string because the
   * count it reports can span more than this one line — a `Conversation`
   * reads it across every line of the request it is showing, not just the
   * page now on screen.
   */
  readonly pageIndicator: () => string | null;
}

/** The indicator a caller with no larger request to count across wants: this line's own "n / N" over its display pages, or nothing when it only has one. */
export function perLinePageIndicator(box: DialogBox): () => string | null {
  return () => (box.pageCount() > 1 ? `${box.currentPageNumber()} / ${box.pageCount()}` : null);
}

/**
 * How many display pages `paragraphs` would split into at the live viewport,
 * without showing them — for a caller (`Conversation`) that has to count
 * pages across several lines at once, not just the one a box has on screen.
 * Uses the same wrap width and line budget `DialogBox` paginates its own
 * content against, so the count this returns for the line currently showing
 * always agrees with that box's own `pageCount()`.
 */
export function countDisplayPages(paragraphs: Paragraphs, showFooterHint: boolean): number {
  const width = Math.min(DIALOG_MAX_WIDTH, viewportWidth() - DIALOG_SIDE_MARGIN * 2);
  const maxWidth = width - DIALOG_PADDING * 2;
  const footerReserve = showFooterHint
    ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
    : TEXT_AREA_BOTTOM_GAP;
  const chrome = TEXT_AREA_Y + footerReserve;
  const hotbarTop = viewportHeight() - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
  const maxHeight = Math.max(DIALOG_HEIGHT, hotbarTop - GAP_ABOVE_HOTBAR - DIALOG_MIN_TOP);
  const maxLines = Math.max(1, Math.floor((maxHeight - chrome) / TEXT_LINE_HEIGHT));
  const ctx = measuringContext();
  ctx.font = `${TEXT_SIZE}px monospace`;
  const measure = (text: string): number => ctx.measureText(text).width;
  return paginate(paragraphs, measure, maxWidth, maxLines).length;
}

interface PageCache {
  readonly paragraphs: Paragraphs;
  readonly maxWidth: number;
  readonly maxLines: number;
  readonly pages: ReadonlyArray<Page>;
}

/**
 * The current display page's computed geometry and text, exposed so a test
 * harness can assert a page fits without re-deriving this box's own wrap
 * width, line budget and font.
 */
export interface DialogLayout {
  /** The width, in px, the body text wraps to. */
  readonly textWidth: number;
  /** The most lines a page may hold at the live viewport. */
  readonly maxLines: number;
  /** The current display page's full text, independent of reveal progress. */
  readonly pageText: string;
  /** The CSS font string the body text is drawn with. */
  readonly font: string;
}

function applyTextCase(paragraphs: Paragraphs, textCase: TextCase): Paragraphs {
  if (textCase === 'as-written') return paragraphs;
  const [first, ...rest] = paragraphs;
  return [first.toUpperCase(), ...rest.map((paragraph) => paragraph.toUpperCase())];
}

export class DialogBox {
  /** Null when the scene has no audio manager — the box still works, silently. */
  private readonly _audio: AudioManager | null;
  private readonly _showFooterHint: boolean;

  private _visible = false;
  private _height = DIALOG_HEIGHT;
  private _paragraphs: Paragraphs | null = null;
  private _speaker: ResolvedSpeaker | null = null;
  private _questRelated = false;

  private _pageCache: PageCache | null = null;
  private _currentPageIndex = 0;
  /** Set for exactly one pagination pass after a resize remaps the current page — tells reveal-state setup to finish the reveal instead of restarting it. */
  private _pendingResizeRemap = false;

  /** The page text the current `_tokens` were built from — retokenized whenever this stops matching the current page. */
  private _tokenizedPageText: string | null = null;
  private _tokens: string[] = [];
  private _revealedCount = 0;
  private _lastRevealTime = 0;
  /** Whether this line's voice clip has already played — reset only by `show()`, so a line split across several display pages speaks once. */
  private _voiceSpoken = false;
  private _pageIndicator: (() => string | null) | null = null;

  constructor(audio: AudioManager | null, config: DialogBoxConfig) {
    this._audio = audio;
    this._showFooterHint = config.showFooterHint;
  }

  private _playRevealSound(): void {
    const voice = this._speaker?.voice;
    if (voice === undefined || voice.kind === 'silent') return;
    if (voice.kind === 'typing') {
      this._audio?.play('typing_click');
      return;
    }
    if (this._voiceSpoken) return;
    this._voiceSpoken = true;
    this._audio?.playRandom(voice.sounds);
  }

  /** Begin showing a line. Resets any in-progress animation and starts from its first display page. */
  show(paragraphs: Paragraphs, speaker: ResolvedSpeaker, options: ShowOptions): void {
    this._paragraphs = applyTextCase(paragraphs, speaker.textCase);
    this._speaker = speaker;
    this._visible = true;
    this._questRelated = options.questRelated;
    this._pageIndicator = options.pageIndicator;
    this._pageCache = null;
    this._currentPageIndex = 0;
    this._pendingResizeRemap = false;
    this._tokenizedPageText = null;
    this._voiceSpoken = false;
  }

  /** Call once per frame to advance the reveal animation. */
  update(): void {
    if (!this._visible) return;
    const speaker = this._speaker;
    if (speaker === null || speaker.reveal === 'all' || this.isFullyRevealed()) return;

    const now = performance.now();
    const readyForNextToken = now - this._lastRevealTime >= speaker.revealIntervalMs;
    if (!readyForNextToken) return;

    this._lastRevealTime = now;
    this._revealedCount++;
    this._playRevealSound();
  }

  /** True once all of the current display page's text has been revealed. */
  isFullyRevealed(): boolean {
    this._sync();
    return this._revealedCount >= this._tokens.length;
  }

  /** True while the dialog is showing. */
  isVisible(): boolean {
    return this._visible;
  }

  /** Number of display pages the current line has been split into. */
  pageCount(): number {
    this._sync();
    return this._pageCache?.pages.length ?? 1;
  }

  /** 1-based index of the display page now showing. */
  currentPageNumber(): number {
    this._sync();
    return this._currentPageIndex + 1;
  }

  /** True when there is no further display page to advance to for the current line. */
  isLastPageOfLine(): boolean {
    this._sync();
    return this._currentPageIndex >= this.pageCount() - 1;
  }

  /**
   * Which paragraph (0-based) the current display page belongs to — for a
   * caller that keeps its own per-paragraph data (a speaker per line, say)
   * and needs to index it by paragraph rather than by the box's own
   * auto-split display page.
   */
  currentLineIndex(): number {
    this._sync();
    const paragraphs = this._paragraphs;
    const page = this._currentPage();
    if (paragraphs === null || page === null) return 0;
    let sourceOffset = 0;
    let result = 0;
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) sourceOffset += 1;
      if (sourceOffset <= page.startOffset) result = index;
      sourceOffset += paragraph.length;
    });
    return result;
  }

  /** Moves to the next display page of the current line. Returns false, and does nothing, if already on the last one. */
  advancePage(): boolean {
    this._sync();
    if (this.isLastPageOfLine()) return false;
    this._currentPageIndex++;
    this._tokenizedPageText = null;
    this._sync();
    return true;
  }

  /** Immediately reveal all remaining text on the current page without further animation. */
  skipToEnd(): void {
    this._sync();
    this._revealedCount = this._tokens.length;
  }

  /**
   * Makes sure the current display page — and its reveal-token state — is
   * computed against the live viewport. Idempotent; cheap to call from every
   * accessor, since it's a no-op once the cache already matches.
   */
  private _sync(): void {
    this._ensurePaginated();
    this._ensurePageRevealState();
  }

  /** Hide the dialog. */
  hide(): void {
    this._visible = false;
    this._paragraphs = null;
    this._speaker = null;
    this._pageCache = null;
    this._currentPageIndex = 0;
    this._pendingResizeRemap = false;
    this._tokenizedPageText = null;
    this._tokens = [];
    this._revealedCount = 0;
    this._questRelated = false;
    this._pageIndicator = null;
  }

  /**
   * Render the dialog box. Call once per frame after update().
   * @param alpha Optional 0–1 opacity for fade-out effects. Default: 1 (fully opaque).
   */
  render(ctx: CanvasRenderingContext2D, alpha = 1): void {
    if (!this._visible || this._paragraphs === null || this._speaker === null) return;

    this._sync();

    const { maxWidth, maxHeight, chrome } = this._layoutBudget();
    const pageText = this._currentPage()?.text ?? '';
    const { totalHeight } = measureTextBox(ctx, pageText, {
      size: TEXT_SIZE,
      width: maxWidth,
      lineHeight: TEXT_LINE_HEIGHT,
    });
    this._height = Math.min(maxHeight, Math.max(DIALOG_HEIGHT, totalHeight + chrome));

    const { x: dx, y: dy, width: dw } = this._computeRect();

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;

    drawBox(ctx, {
      x: dx,
      y: dy,
      width: dw,
      height: this._height,
      fill: DIALOG_BG,
      border: BORDER_COLOR,
      borderWidth: BORDER_WIDTH,
      radius: BORDER_RADIUS,
    });

    this._renderSpeakerRow(ctx, dx, dy);
    this._renderBodyText(ctx, dx, dy, dw);
    this._renderFooterHint(ctx, dx, dy, dw);
    if (this._questRelated) {
      drawQuestIcon(ctx, dx + dw - QUEST_ICON_MARGIN, dy + QUEST_ICON_MARGIN, QUEST_ICON_SIZE);
    }

    ctx.restore();
  }

  /**
   * The box's screen rectangle.
   *
   * Exposed so callers that draw their own controls against the dialog — a row of
   * choice buttons above it, say — can position them from the real geometry
   * instead of re-deriving it from copies of these constants, which would drift
   * the moment the box is resized.
   */
  rect(): { x: number; y: number; width: number; height: number } {
    return { ...this._computeRect(), height: this._height };
  }

  /**
   * Returns true if the given canvas point falls inside the dialog box.
   * Useful for routing click events.
   */
  contains(px: number, py: number): boolean {
    const { x, y, width } = this._computeRect();
    return px >= x && px <= x + width && py >= y && py <= y + this._height;
  }

  /**
   * The current display page's wrap width, line budget, text and font — for
   * a test harness that asserts a page fits the box without re-deriving this
   * class's own layout math.
   */
  layout(): DialogLayout {
    this._sync();
    const { maxWidth, maxLines } = this._layoutBudget();
    return {
      textWidth: maxWidth,
      maxLines,
      pageText: this._currentPage()?.text ?? '',
      font: `${TEXT_SIZE}px monospace`,
    };
  }

  private _currentPage(): Page | null {
    const cache = this._pageCache;
    if (cache === null) return null;
    if (this._currentPageIndex < 0 || this._currentPageIndex >= cache.pages.length) return null;
    return cache.pages[this._currentPageIndex];
  }

  /**
   * The room available to the body text against the live viewport: the
   * width a line wraps to, the most lines a page may ever hold, the
   * chrome (speaker row, footer) that leaves the rest for text, and the
   * box's own absolute ceiling. None of this depends on which `ctx` (if
   * any) has drawn the box yet.
   */
  private _layoutBudget(): {
    maxWidth: number;
    maxLines: number;
    maxHeight: number;
    chrome: number;
  } {
    const { width: measuringWidth } = this._computeRect();
    const maxWidth = measuringWidth - DIALOG_PADDING * 2;
    const footerReserve = this._showFooterHint
      ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
      : TEXT_AREA_BOTTOM_GAP;
    const chrome = TEXT_AREA_Y + footerReserve;
    const hotbarTop = viewportHeight() - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
    const maxHeight = Math.max(DIALOG_HEIGHT, hotbarTop - GAP_ABOVE_HOTBAR - DIALOG_MIN_TOP);
    const maxLines = Math.max(1, Math.floor((maxHeight - chrome) / TEXT_LINE_HEIGHT));
    return { maxWidth, maxLines, maxHeight, chrome };
  }

  /**
   * Recomputes pages when the content or the layout budget has changed. On a
   * pure layout change (a resize, mid-reading) the reader's place is kept by
   * finding the page that now contains the old page's `startOffset`.
   */
  private _ensurePaginated(): void {
    const paragraphs = this._paragraphs;
    if (paragraphs === null) return;

    const { maxWidth, maxLines } = this._layoutBudget();
    const cache = this._pageCache;
    const sameContent = cache !== null && cache.paragraphs === paragraphs;
    const sameLayout = cache !== null && cache.maxWidth === maxWidth && cache.maxLines === maxLines;
    if (cache !== null && sameContent && sameLayout) return;

    const previousStartOffset =
      cache !== null && sameContent ? (this._currentPage()?.startOffset ?? null) : null;
    const ctx = measuringContext();
    ctx.font = `${TEXT_SIZE}px monospace`;
    const measure = (text: string): number => ctx.measureText(text).width;
    const pages = paginate(paragraphs, measure, maxWidth, maxLines);
    this._pageCache = { paragraphs, maxWidth, maxLines, pages };

    if (previousStartOffset !== null) {
      this._currentPageIndex = this._pageIndexContaining(pages, previousStartOffset);
      this._pendingResizeRemap = true;
    } else {
      this._currentPageIndex = 0;
    }
    this._tokenizedPageText = null;
  }

  private _pageIndexContaining(pages: ReadonlyArray<Page>, offset: number): number {
    let result = 0;
    pages.forEach((page, index) => {
      if (page.startOffset <= offset) result = index;
    });
    return result;
  }

  /** Tokenizes and starts revealing the current page's text, the first time render() sees it. */
  private _ensurePageRevealState(): void {
    const page = this._currentPage();
    const speaker = this._speaker;
    if (page === null || speaker === null) return;
    if (this._tokenizedPageText === page.text) return;

    this._tokenizedPageText = page.text;
    this._tokens = this._tokenize(page.text, speaker.reveal);

    if (this._pendingResizeRemap) {
      this._pendingResizeRemap = false;
      this._revealedCount = this._tokens.length;
      return;
    }

    if (speaker.reveal === 'all' || this._tokens.length === 0) {
      this._revealedCount = this._tokens.length;
    } else {
      this._revealedCount = 1;
      this._lastRevealTime = performance.now();
    }
    if (this._tokens.length > 0) this._playRevealSound();
  }

  private _renderSpeakerRow(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
    const speaker = this._speaker;
    if (speaker === null) return;
    let speakerTextX = dx + DIALOG_PADDING;
    const rowY = dy + SPEAKER_ROW_Y;

    if (speaker.portrait !== null) {
      ctx.drawImage(speaker.portrait, speakerTextX, rowY, ICON_SIZE, ICON_SIZE);
      speakerTextX += ICON_SIZE + ICON_GAP;
    }

    if (speaker.name !== null) {
      drawText(ctx, speaker.name, {
        x: speakerTextX,
        y: rowY,
        size: SPEAKER_SIZE,
        bold: true,
        color: SPEAKER_COLOR,
      });
    }
  }

  private _renderBodyText(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number): void {
    const textAreaWidth = dw - DIALOG_PADDING * 2;
    const footerReserve = this._showFooterHint
      ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
      : TEXT_AREA_BOTTOM_GAP;
    const textAreaHeight = this._height - TEXT_AREA_Y - footerReserve;
    drawText(ctx, this._displayText, {
      x: dx + DIALOG_PADDING,
      y: dy + TEXT_AREA_Y,
      size: TEXT_SIZE,
      color: TEXT_COLOR,
      width: textAreaWidth,
      height: textAreaHeight,
      lineHeight: TEXT_LINE_HEIGHT,
    });
  }

  private _renderFooterHint(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
  ): void {
    if (!this._showFooterHint) return;
    const footerY = dy + this._height - FOOTER_Y_FROM_BOTTOM;

    const indicator = this._pageIndicator?.() ?? null;
    if (indicator !== null) {
      drawText(ctx, indicator, {
        x: dx + DIALOG_PADDING,
        y: footerY,
        size: FOOTER_HINT_SIZE,
        color: HINT_COLOR,
      });
    }

    const hintLabel = !this.isFullyRevealed()
      ? '[Space / Click] Skip'
      : this.isLastPageOfLine()
        ? '[Space / Click] Close'
        : '[Space / Click] Continue';
    drawText(ctx, hintLabel, {
      x: dx + dw - DIALOG_PADDING,
      y: footerY,
      size: FOOTER_HINT_SIZE,
      color: HINT_COLOR,
      align: 'right',
    });
  }

  private _computeRect(): { x: number; y: number; width: number } {
    const hotbarTop = viewportHeight() - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
    const width = Math.min(DIALOG_MAX_WIDTH, viewportWidth() - DIALOG_SIDE_MARGIN * 2);
    const x = (viewportWidth() - width) / 2;
    const y = Math.max(DIALOG_MIN_TOP, hotbarTop - GAP_ABOVE_HOTBAR - this._height);
    return { x, y, width };
  }

  private get _displayText(): string {
    if (this._revealedCount === 0) return '';
    const revealed = this._tokens.slice(0, this._revealedCount);
    const speaker = this._speaker;
    return speaker !== null && speaker.reveal === 'word' ? revealed.join(' ') : revealed.join('');
  }

  private _tokenize(text: string, mode: RevealMode): string[] {
    switch (mode) {
      case 'all':
        return [text];
      case 'sentence':
        return [...splitSentences(text)];
      case 'word':
        return text.split(/\s+/).filter((word) => word.length > 0);
      case 'letter':
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        return [...text];
    }
  }
}
