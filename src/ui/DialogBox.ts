/**
 * Reusable chat-style dialog box. Shows a speaker name (with optional icon)
 * and body text with a configurable reveal animation synchronized to the
 * typing_click sound.
 *
 * Typical usage:
 *   1. Construct once, passing the scene's AudioManager.
 *   2. Call show(text) to begin a dialog.
 *   3. Call update() each frame.
 *   4. Call render(ctx, canvas) each frame.
 *   5. On space/click: if isFullyRevealed(), close or advance; else call skipToEnd().
 */

import { drawBox } from './Box';
import { drawText } from './TextBox';
import type { AudioManager } from '../audio/AudioManager';

/** Duration in ms between revealed elements — matches the typing_click sound length. */
const TYPING_CLICK_DURATION_MS = 100;

// Layout geometry
const DIALOG_MAX_WIDTH = 560;
const DIALOG_HEIGHT = 175;
const DIALOG_SIDE_MARGIN = 20;
const GAP_ABOVE_HOTBAR = 8;
const DIALOG_PADDING = 14;
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
/** Minimum preceding-word length before a period is treated as a sentence boundary. */
const MIN_SENTENCE_WORD_LEN = 3;

// Colors — warm parchment/candlelight theme matching Mordecai's tutorial dialog
const DIALOG_BG = 'rgba(10,8,6,0.92)';
const BORDER_COLOR = '#c8a860';
const BORDER_WIDTH = 2;
const TEXT_COLOR = '#e8dfc8';
const SPEAKER_COLOR = '#c8a860';
const HINT_COLOR = '#7a6e5a';

/** Controls how the dialog body text is progressively revealed. */
export type RevealMode = 'all' | 'sentence' | 'word' | 'letter';

export interface DialogBoxConfig {
  /** Name displayed as the speaker label. */
  speakerName: string;
  /** Optional image drawn as a small avatar beside the speaker name. */
  speakerIcon?: HTMLImageElement;
  /** How text is progressively revealed. Default: 'all' */
  revealMode?: RevealMode;
  /**
   * Pixels to raise the dialog above its default position (just above the hotbar).
   * Positive values move it up on screen. Default: 0
   */
  yOffset?: number;
  /**
   * Whether to render the Skip / Continue footer hint. Set to false for dialogs
   * that auto-dismiss and have no user interaction. Default: true
   */
  showFooterHint?: boolean;
}

/** Options passed to show() to configure per-message behaviour. */
export interface ShowOptions {
  /**
   * For multi-page dialogs, the 1-based current page number and total page count.
   * Renders a "1 / 3" counter on the left side of the footer and changes the
   * right-side hint to "Close" on the last page instead of "Continue".
   */
  pageIndicator?: { readonly current: number; readonly total: number };
}

export class DialogBox {
  private readonly _audio: AudioManager;
  private readonly _speakerName: string;
  private readonly _speakerIcon: HTMLImageElement | undefined;
  private readonly _revealMode: RevealMode;
  private readonly _yOffset: number;
  private readonly _showFooterHint: boolean;

  private _visible = false;
  private _tokens: string[] = [];
  private _revealedCount = 0;
  private _lastRevealTime = 0;
  private _pageIndicator: { readonly current: number; readonly total: number } | null = null;

  constructor(audio: AudioManager, config: DialogBoxConfig) {
    this._audio = audio;
    this._speakerName = config.speakerName;
    this._speakerIcon = config.speakerIcon;
    this._revealMode = config.revealMode ?? 'all';
    this._yOffset = config.yOffset ?? 0;
    this._showFooterHint = config.showFooterHint ?? true;
  }

  /**
   * Begin displaying text. Resets any in-progress animation.
   * The first element is revealed immediately; subsequent elements follow at
   * TYPING_CLICK_DURATION_MS intervals (except in 'all' mode, which reveals
   * everything at once).
   */
  show(text: string, options?: ShowOptions): void {
    this._tokens = this._tokenize(text);
    this._visible = true;
    this._pageIndicator = options?.pageIndicator ?? null;

    if (this._revealMode === 'all' || this._tokens.length === 0) {
      this._revealedCount = this._tokens.length;
      if (this._tokens.length > 0) {
        this._audio.play('typing_click');
      }
    } else {
      this._revealedCount = 1;
      this._lastRevealTime = performance.now();
      this._audio.play('typing_click');
    }
  }

  /** Call once per frame to advance the reveal animation. */
  update(): void {
    if (!this._visible || this.isFullyRevealed() || this._revealMode === 'all') return;

    const now = performance.now();
    const readyForNextToken = now - this._lastRevealTime >= TYPING_CLICK_DURATION_MS;
    if (!readyForNextToken) return;

    this._lastRevealTime = now;
    this._revealedCount++;
    this._audio.play('typing_click');
  }

  /** True once all text has been revealed. */
  isFullyRevealed(): boolean {
    return this._revealedCount >= this._tokens.length;
  }

  /** True while the dialog is showing. */
  isVisible(): boolean {
    return this._visible;
  }

  /** Immediately reveal all remaining text without further animation. */
  skipToEnd(): void {
    this._revealedCount = this._tokens.length;
  }

  /** Hide the dialog. */
  hide(): void {
    this._visible = false;
    this._pageIndicator = null;
  }

  /**
   * Render the dialog box. Call once per frame after update().
   * @param alpha Optional 0–1 opacity for fade-out effects. Default: 1 (fully opaque).
   */
  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, alpha = 1): void {
    if (!this._visible) return;

    const { x: dx, y: dy, width: dw } = this._computeRect(canvas);

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;

    drawBox(ctx, {
      x: dx,
      y: dy,
      width: dw,
      height: DIALOG_HEIGHT,
      fill: DIALOG_BG,
      border: BORDER_COLOR,
      borderWidth: BORDER_WIDTH,
      radius: BORDER_RADIUS,
    });

    this._renderSpeakerRow(ctx, dx, dy);
    this._renderBodyText(ctx, dx, dy, dw);
    this._renderFooterHint(ctx, dx, dy, dw);

    ctx.restore();
  }

  /**
   * Returns true if the given canvas point falls inside the dialog box.
   * Useful for routing click events.
   */
  contains(px: number, py: number, canvas: HTMLCanvasElement): boolean {
    const { x, y, width } = this._computeRect(canvas);
    return px >= x && px <= x + width && py >= y && py <= y + DIALOG_HEIGHT;
  }

  private _renderSpeakerRow(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
    let speakerTextX = dx + DIALOG_PADDING;
    const rowY = dy + SPEAKER_ROW_Y;

    if (this._speakerIcon !== undefined) {
      ctx.drawImage(this._speakerIcon, speakerTextX, rowY, ICON_SIZE, ICON_SIZE);
      speakerTextX += ICON_SIZE + ICON_GAP;
    }

    drawText(ctx, this._speakerName, {
      x: speakerTextX,
      y: rowY,
      size: SPEAKER_SIZE,
      bold: true,
      color: SPEAKER_COLOR,
    });
  }

  private _renderBodyText(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number): void {
    const textAreaWidth = dw - DIALOG_PADDING * 2;
    const footerReserve = this._showFooterHint
      ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
      : TEXT_AREA_BOTTOM_GAP;
    const textAreaHeight = DIALOG_HEIGHT - TEXT_AREA_Y - footerReserve;
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
    const footerY = dy + DIALOG_HEIGHT - FOOTER_Y_FROM_BOTTOM;

    if (this._pageIndicator !== null) {
      drawText(ctx, `${this._pageIndicator.current} / ${this._pageIndicator.total}`, {
        x: dx + DIALOG_PADDING,
        y: footerY,
        size: FOOTER_HINT_SIZE,
        color: HINT_COLOR,
      });
    }

    const isLastPage =
      this._pageIndicator === null || this._pageIndicator.current === this._pageIndicator.total;
    const hintLabel = !this.isFullyRevealed()
      ? '[Space / Click] Skip'
      : isLastPage
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

  private _computeRect(canvas: HTMLCanvasElement): { x: number; y: number; width: number } {
    const hotbarTop = canvas.height - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
    const width = Math.min(DIALOG_MAX_WIDTH, canvas.width - DIALOG_SIDE_MARGIN * 2);
    const x = (canvas.width - width) / 2;
    const y = hotbarTop - GAP_ABOVE_HOTBAR - DIALOG_HEIGHT - this._yOffset;
    return { x, y, width };
  }

  private get _displayText(): string {
    if (this._revealedCount === 0) return '';
    const revealed = this._tokens.slice(0, this._revealedCount);
    return this._revealMode === 'word' ? revealed.join(' ') : revealed.join('');
  }

  private _tokenize(text: string): string[] {
    switch (this._revealMode) {
      case 'all':
        return [text];
      case 'sentence':
        return this._splitSentences(text);
      case 'word':
        return text.split(/\s+/).filter((w) => w.length > 0);
      case 'letter':
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        return [...text];
    }
  }

  private _splitSentences(text: string): string[] {
    const sentences: string[] = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      current += char;
      if ('.!?;'.includes(char)) {
        const nextChar = text.charAt(i + 1); // empty string when i is the last index
        const isEndOfText = nextChar === '';
        // ! and ? are unambiguous sentence boundaries. For . and ;, only break when
        // the preceding word is 3+ characters to guard against abbreviations like
        // "Dr.", "Mr.", "e.g.", or loading placeholders like "...".
        const isEmphatic = char === '!' || char === '?';
        const wordBefore = current.slice(0, -1).trimEnd().split(/\s+/).pop() ?? '';
        const isLikelySentenceEnd =
          wordBefore.length >= MIN_SENTENCE_WORD_LEN && (nextChar === ' ' || nextChar === '\n');
        if (isEndOfText || isEmphatic || isLikelySentenceEnd) {
          sentences.push(current);
          current = '';
        }
      }
    }
    if (current.trim().length > 0) {
      sentences.push(current);
    }
    return sentences.length > 0 ? sentences : [text];
  }
}
