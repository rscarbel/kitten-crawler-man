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

import type { Rect } from './core/geom';
import { drawQuestIcon } from './QuestIcon';
import { chromeTarget } from './screens/dialogs/canvasChrome';
import { TERMINAL_FONT_STACK, UI_FONT_STACK } from './theme/fonts';
import { skinsFor } from './theme/skins';
import { fontFor, type, type Theme } from './theme/tokens';
import { drawGlass, fillRounded, strokeRounded, type PaintTarget } from './widgets/paint';
import { measureText, text as drawLabel } from './widgets/text';
import type { AudioManager } from '../audio/AudioManager';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { allocCanvas, surfaceContext } from '../core/canvasSurface';
import type { Paragraphs } from '../dialog/line';
import { computeLineSpans, paginate, splitSentences, type Page } from '../dialog/paginate';
import type { SpeakerTypeface, SpeakerVoice, TextCase } from '../dialog/speakers';

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
/**
 * Ceiling on body lines per page, however tall the viewport. A big screen
 * could fit dozens, but a wall of text reads badly in a speech box; past
 * this the line pages instead. Six is what `DIALOG_HEIGHT` already holds
 * with the footer, so a full page never grows the box.
 */
const MAX_LINES_PER_PAGE = 6;
const HOTBAR_SLOT_SIZE = 52;
const HOTBAR_BOTTOM_MARGIN = 12;

// Content positions relative to the dialog's top-left
const SPEAKER_ROW_Y = 10;
const ICON_SIZE = 20;
const ICON_GAP = 8;
const TEXT_AREA_Y = 34;
const BODY_STYLE = type.body;
const TEXT_LINE_HEIGHT = BODY_STYLE.lineHeight;
const FOOTER_Y_FROM_BOTTOM = 18;
const TEXT_AREA_BOTTOM_GAP = 4;
const QUEST_ICON_SIZE = 16;
const QUEST_ICON_MARGIN = 10;
const PORTRAIT_BORDER_WIDTH = 1;
const SPEAKER_PLATE_BORDER_WIDTH = 1;

/** The CSS font family a speaker's body text is set in. */
function bodyFontFamily(typeface: SpeakerTypeface): string {
  return typeface === 'terminal' ? TERMINAL_FONT_STACK : UI_FONT_STACK;
}

/** The full CSS font the body text is measured and drawn in for `typeface`. */
function bodyFont(typeface: SpeakerTypeface): string {
  return fontFor(BODY_STYLE, bodyFontFamily(typeface));
}

/**
 * `text` broken into the lines the box draws it on, by the same rule
 * `paginate` counts them with, so a page's drawn lines never outnumber the
 * lines it was cut to.
 */
function wrapBodyLines(text: string, maxWidth: number, typeface: SpeakerTypeface): string[] {
  const ctx = measuringContext();
  ctx.font = bodyFont(typeface);
  const spans = computeLineSpans(text, maxWidth, (line) => ctx.measureText(line).width);
  return spans.map((span) => text.slice(span.offset, span.offset + span.length));
}

const bodyThemes = new WeakMap<Theme, Map<string, Theme>>();

/** `theme` with the body face of `typeface` in place of the UI face, built once per pair. */
function bodyTheme(theme: Theme, typeface: SpeakerTypeface): Theme {
  const family = bodyFontFamily(typeface);
  if (family === theme.fontFamily) return theme;
  const byFamily = bodyThemes.get(theme) ?? new Map<string, Theme>();
  bodyThemes.set(theme, byFamily);
  const cached = byFamily.get(family);
  if (cached !== undefined) return cached;
  const built: Theme = { ...theme, fontFamily: family };
  byFamily.set(family, built);
  return built;
}

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
  /** Omitted means the UI face. */
  readonly typeface?: SpeakerTypeface;
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
   * no choice — a choice that matters wears the badge itself instead.
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

/**
 * How many display pages `paragraphs` would split into at the live viewport,
 * without showing them — for a caller (`Conversation`) that has to count
 * pages across several lines at once, not just the one a box has on screen.
 * Uses the same wrap width and line budget `DialogBox` paginates its own
 * content against, so the count this returns for the line currently showing
 * always agrees with that box's own `pageCount()`.
 */
export function countDisplayPages(
  paragraphs: Paragraphs,
  showFooterHint: boolean,
  typeface: SpeakerTypeface = 'ui',
): number {
  const { maxWidth, maxLines } = layoutBudget(showFooterHint);
  const ctx = measuringContext();
  ctx.font = bodyFont(typeface);
  const measure = (line: string): number => ctx.measureText(line).width;
  return paginate(paragraphs, measure, maxWidth, maxLines).length;
}

/**
 * The room available to the body text against the live viewport: the
 * width a line wraps to, the most lines a page may ever hold, the
 * chrome (speaker row, footer) that leaves the rest for text, and the
 * box's own absolute ceiling. Shared by `countDisplayPages` and
 * `DialogBox` so both always paginate identically.
 */
function layoutBudget(showFooterHint: boolean): {
  maxWidth: number;
  maxLines: number;
  maxHeight: number;
  chrome: number;
} {
  const maxWidth = dialogWidth() - DIALOG_PADDING * 2;
  const footerReserve = showFooterHint
    ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
    : TEXT_AREA_BOTTOM_GAP;
  const chrome = TEXT_AREA_Y + footerReserve;
  const hotbarTop = viewportHeight() - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
  const maxHeight = Math.max(DIALOG_HEIGHT, hotbarTop - GAP_ABOVE_HOTBAR - DIALOG_MIN_TOP);
  const linesThatFit = Math.floor((maxHeight - chrome) / TEXT_LINE_HEIGHT);
  const maxLines = Math.max(1, Math.min(MAX_LINES_PER_PAGE, linesThatFit));
  return { maxWidth, maxLines, maxHeight, chrome };
}

function dialogWidth(): number {
  return Math.min(DIALOG_MAX_WIDTH, viewportWidth() - DIALOG_SIDE_MARGIN * 2);
}

interface PageCache {
  readonly paragraphs: Paragraphs;
  readonly maxWidth: number;
  readonly maxLines: number;
  /** The font string and the probe's width in it when the pages were cut. */
  readonly font: string;
  readonly fontProbeWidth: number;
  readonly pages: ReadonlyArray<Page>;
}

/**
 * Measured to notice the face changing under an unchanged font string: the UI
 * face can finish loading after a page was cut against its fallback.
 */
const FONT_PROBE_TEXT = 'The quick brown fox jumps over the lazy dog';

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

    this._fitHeight();
    const { x: dx, y: dy, width: dw } = this._computeRect();
    const target = chromeTarget(ctx);

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;

    drawGlass(target, { x: dx, y: dy, w: dw, h: this._height }, skinsFor(target.theme).panel.card);

    this._renderSpeakerRow(target, dx, dy);
    this._renderBodyText(target, dx, dy, dw);
    this._renderFooterHint(target, dx, dy, dw);
    if (this._questRelated) {
      drawQuestIcon(ctx, dx + dw - QUEST_ICON_MARGIN, dy + QUEST_ICON_MARGIN, QUEST_ICON_SIZE);
    }

    ctx.restore();
  }

  /**
   * Grows the box to the page now showing, between its resting height and
   * the most the viewport allows.
   */
  private _fitHeight(): void {
    if (this._paragraphs === null || this._speaker === null) return;
    this._sync();
    const { maxWidth, maxHeight, chrome } = layoutBudget(this._showFooterHint);
    const pageText = this._currentPage()?.text ?? '';
    const pageHeight = wrapBodyLines(pageText, maxWidth, this._typeface).length * TEXT_LINE_HEIGHT;
    this._height = Math.min(maxHeight, Math.max(DIALOG_HEIGHT, pageHeight + chrome));
  }

  /**
   * The box's screen rectangle, in canvas CSS pixels, sized to the page now
   * showing.
   *
   * Exposed so callers that draw their own controls against the dialog — a row of
   * choice buttons above it, say — can position them from the real geometry
   * instead of re-deriving it from copies of these constants, which would drift
   * the moment the box is resized.
   */
  rect(): Rect {
    this._fitHeight();
    const { x, y, width } = this._computeRect();
    return { x, y, w: width, h: this._height };
  }

  /** Whether the canvas point falls inside the dialog box, its edge pixels included. */
  contains(px: number, py: number): boolean {
    const { x, y, w, h } = this.rect();
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  /**
   * The current display page's wrap width, line budget, text and font — for
   * a test harness that asserts a page fits the box without re-deriving this
   * class's own layout math.
   */
  layout(): DialogLayout {
    this._sync();
    const { maxWidth, maxLines } = layoutBudget(this._showFooterHint);
    return {
      textWidth: maxWidth,
      maxLines,
      pageText: this._currentPage()?.text ?? '',
      font: bodyFont(this._typeface),
    };
  }

  private _currentPage(): Page | null {
    const cache = this._pageCache;
    if (cache === null) return null;
    if (this._currentPageIndex < 0 || this._currentPageIndex >= cache.pages.length) return null;
    return cache.pages[this._currentPageIndex];
  }

  /**
   * Recomputes pages when the content or the layout budget has changed. On a
   * pure layout change (a resize, mid-reading) the reader's place is kept by
   * finding the page that now contains the old page's `startOffset`.
   */
  private _ensurePaginated(): void {
    const paragraphs = this._paragraphs;
    if (paragraphs === null) return;

    const { maxWidth, maxLines } = layoutBudget(this._showFooterHint);
    const font = bodyFont(this._typeface);
    const ctx = measuringContext();
    ctx.font = font;
    const measure = (line: string): number => ctx.measureText(line).width;
    const fontProbeWidth = measure(FONT_PROBE_TEXT);
    const cache = this._pageCache;
    const sameContent = cache !== null && cache.paragraphs === paragraphs;
    const sameLayout =
      cache !== null &&
      cache.maxWidth === maxWidth &&
      cache.maxLines === maxLines &&
      cache.font === font &&
      cache.fontProbeWidth === fontProbeWidth;
    if (cache !== null && sameContent && sameLayout) return;

    const previousStartOffset =
      cache !== null && sameContent ? (this._currentPage()?.startOffset ?? null) : null;
    const pages = paginate(paragraphs, measure, maxWidth, maxLines);
    this._pageCache = { paragraphs, maxWidth, maxLines, font, fontProbeWidth, pages };

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

  private get _typeface(): SpeakerTypeface {
    return this._speaker?.typeface ?? 'ui';
  }

  private _renderSpeakerRow(target: PaintTarget, dx: number, dy: number): void {
    const speaker = this._speaker;
    if (speaker === null) return;
    const { ctx, theme } = target;
    const { palette, radius, space } = theme;
    let plateX = dx + DIALOG_PADDING;
    const rowY = dy + SPEAKER_ROW_Y;

    if (speaker.portrait !== null) {
      const portrait = { x: plateX, y: rowY, w: ICON_SIZE, h: ICON_SIZE };
      fillRounded(ctx, portrait, radius.sm, palette.surface.sunken);
      ctx.drawImage(speaker.portrait, plateX, rowY, ICON_SIZE, ICON_SIZE);
      strokeRounded(ctx, portrait, radius.sm, palette.border.strong, PORTRAIT_BORDER_WIDTH);
      plateX += ICON_SIZE + ICON_GAP;
    }

    if (speaker.name !== null) {
      const nameWidth = measureText(target, speaker.name, { role: 'accent' });
      const plate = { x: plateX, y: rowY, w: nameWidth + space.sm * 2, h: ICON_SIZE };
      fillRounded(ctx, plate, radius.pill, palette.accent.soft);
      strokeRounded(ctx, plate, radius.pill, palette.border.subtle, SPEAKER_PLATE_BORDER_WIDTH);
      drawLabel(
        target,
        { ...plate, x: plate.x + space.sm, w: nameWidth },
        {
          text: speaker.name,
          role: 'accent',
        },
      );
    }
  }

  private _renderBodyText(target: PaintTarget, dx: number, dy: number, dw: number): void {
    const textAreaWidth = dw - DIALOG_PADDING * 2;
    const footerReserve = this._showFooterHint
      ? FOOTER_Y_FROM_BOTTOM + TEXT_AREA_BOTTOM_GAP
      : TEXT_AREA_BOTTOM_GAP;
    const textAreaHeight = this._height - TEXT_AREA_Y - footerReserve;
    const linesThatFit = Math.max(0, Math.floor(textAreaHeight / TEXT_LINE_HEIGHT));
    const lines = wrapBodyLines(this._displayText, textAreaWidth, this._typeface);
    const body: PaintTarget = { ctx: target.ctx, theme: bodyTheme(target.theme, this._typeface) };
    const color = target.theme.palette.text.primary;
    lines.slice(0, linesThatFit).forEach((line, index) => {
      drawLabel(
        body,
        {
          x: dx + DIALOG_PADDING,
          y: dy + TEXT_AREA_Y + index * TEXT_LINE_HEIGHT,
          w: textAreaWidth,
          h: TEXT_LINE_HEIGHT,
        },
        { text: line, style: BODY_STYLE, color },
      );
    });
  }

  private _renderFooterHint(target: PaintTarget, dx: number, dy: number, dw: number): void {
    if (!this._showFooterHint) return;
    const footerY = dy + this._height - FOOTER_Y_FROM_BOTTOM;
    const row = {
      x: dx + DIALOG_PADDING,
      y: footerY,
      w: dw - DIALOG_PADDING * 2,
      h: target.theme.type.caption.lineHeight,
    };

    const indicator = this._pageIndicator?.() ?? null;
    if (indicator !== null) {
      drawLabel(target, row, { text: indicator, role: 'muted', tabular: true, valign: 'top' });
    }

    const hintLabel = !this.isFullyRevealed()
      ? '[Space / Click] Skip'
      : this.isLastPageOfLine()
        ? '[Space / Click] Close'
        : '[Space / Click] Continue';
    drawLabel(target, row, { text: hintLabel, role: 'muted', align: 'right', valign: 'top' });
  }

  private _computeRect(): { x: number; y: number; width: number } {
    const hotbarTop = viewportHeight() - HOTBAR_SLOT_SIZE - HOTBAR_BOTTOM_MARGIN;
    const width = dialogWidth();
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
