/**
 * A paged "how it works" modal with an animated illustration on every page.
 *
 * The frame owns everything that is the same from one explainer to the next —
 * the backdrop, a panel scaled uniformly to fit the viewport, the header and
 * per-page subtitle, the page dots, the Back / Next row inside its own focus
 * ring — and a page supplies only its subtitle, its description lines and a
 * callback that paints its illustration band. A rule that is far clearer shown
 * than described gets a picture without its owner re-building the chrome.
 */

import type { AudioManager } from '../audio/AudioManager';
import {
  beginModalFit,
  drawBox,
  drawOverlay,
  endModalFit,
  modalFitPoint,
  MODAL_FIT_NONE,
  type ModalFit,
} from './Box';
import {
  beginMenuFocus,
  BUTTON_PRESETS,
  drawButton,
  endMenuFocus,
  occludeRenderedButtons,
  resetButtonPointerSpace,
  setButtonPointerSpace,
  type ButtonResult,
} from './Button';
import { fitPanel } from './panelFit';
import { drawText, measureTextBox } from './TextBox';
import { viewportHeight, viewportWidth } from '../core/Viewport';

/** A rectangle in the panel's design-sized coordinate space. */
export interface IllustrationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HowToPlayPage {
  readonly subtitle: string;
  /**
   * Paints the page's illustration inside `rect`. Drawing is clipped to the
   * band. `frame` counts 60 Hz frames since this page was turned to, so an
   * animation always starts from its first beat when the player arrives.
   */
  readonly drawIllustration: (
    ctx: CanvasRenderingContext2D,
    rect: IllustrationRect,
    frame: number,
  ) => void;
  /** Each entry is its own paragraph, word-wrapped to the panel. */
  readonly lines: readonly string[];
}

export interface HowToPlayConfig {
  /** The header over every page. */
  readonly title: string;
  /** The focus-ring id — also the id the owning scene's overlay claim names. */
  readonly focusId: string;
  /** The Next button's label on the last page, where it closes the overlay. */
  readonly finalLabel: string;
}

const PANEL_W = 540;
const PANEL_H = 556;
const PANEL_RADIUS = 6;
const PANEL_BORDER_WIDTH = 2;
const OVERLAY_ALPHA = 0.88;

const HEADER_H = 72;
const HEADER_INSET = 2;
const TITLE_Y = 14;
const TITLE_SIZE = 18;
const SUBTITLE_Y = 44;
const SUBTITLE_SIZE = 13;

const CONTENT_PAD = 18;
const ILLUSTRATION_TOP_GAP = 14;
const ILLUSTRATION_H = 250;
/**
 * The band's height on a viewport too short for the full panel. Giving up
 * illustration height there buys text size: a landscape phone scales the full
 * panel to about two thirds, which leaves the description lines unreadable.
 */
const ILLUSTRATION_H_COMPACT = 160;

const LINES_TOP_GAP = 14;
const LINE_SIZE = 12;
const LINE_HEIGHT = 16;
const PARAGRAPH_GAP = 7;

const FOOTER_BTN_W = 132;
const FOOTER_BTN_H = 36;
const FOOTER_BOTTOM_PAD = 14;
const FOOTER_LABEL_SIZE = 13;

const DOT_RADIUS = 4;
const DOT_GAP = 14;

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const HALF = 0.5;
const TWO_PI = Math.PI * 2;

const PANEL_FILL = '#0b1220';
const ACCENT = '#fbbf24';
const HEADER_FILL = '#1a2540';
const SUBTITLE_COLOR = '#93c5fd';
const BAND_FILL = '#0d1626';
const BAND_BORDER = '#1e3050';
const LINE_COLOR = '#cbd5e1';
const DOT_IDLE = '#334155';

const BACK_LABEL = '‹ Back';
const SKIP_LABEL = 'Skip';
const NEXT_LABEL = 'Next  ›';

export class HowToPlayOverlay {
  private pages: readonly HowToPlayPage[] = [];
  private pageIndex = 0;
  private pageShownAtMs = 0;
  private onClose: (() => void) | null = null;
  private fit: ModalFit = MODAL_FIT_NONE;
  private backButton: ButtonResult | null = null;
  private nextButton: ButtonResult | null = null;

  /**
   * @param clockMs The clock the illustrations animate against. Wall time
   *   rather than update ticks, because the overlay halts the world — and a
   *   halted scene is exactly the one whose update count stops meaning time.
   */
  constructor(
    private readonly audio: AudioManager | null,
    private readonly config: HowToPlayConfig,
    private readonly clockMs: () => number = () => performance.now(),
  ) {}

  get isOpen(): boolean {
    return this.pages.length > 0;
  }

  /** Zero-based index of the page on screen. */
  get currentPage(): number {
    return this.pageIndex;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /**
   * @param onClose Runs once when the overlay closes, by any route — the last
   *   page's button, Skip, or Escape.
   */
  open(pages: readonly HowToPlayPage[], onClose?: () => void): void {
    if (pages.length === 0) return;
    this.pages = pages;
    this.onClose = onClose ?? null;
    this.showPage(0);
  }

  /** Next: forward a page, and close off the last one. */
  advance(): void {
    if (!this.isOpen) return;
    if (this.pageIndex >= this.pages.length - 1) {
      this.close();
      return;
    }
    this.showPage(this.pageIndex + 1);
  }

  /** Back a page; on the first page the same button is Skip. */
  back(): void {
    if (!this.isOpen) return;
    if (this.pageIndex === 0) {
      this.close();
      return;
    }
    this.showPage(this.pageIndex - 1);
  }

  close(): void {
    if (!this.isOpen) return;
    this.pages = [];
    this.pageIndex = 0;
    this.backButton = null;
    this.nextButton = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  /**
   * Routes a click or tap. Always consumes it while open, so nothing behind the
   * panel can take a press aimed at it.
   */
  handleClick(mx: number, my: number): boolean {
    if (!this.isOpen) return false;
    const point = modalFitPoint(this.fit, mx, my);
    if (this.nextButton?.contains(point.x, point.y) === true) {
      this.advance();
      return true;
    }
    if (this.backButton?.contains(point.x, point.y) === true) {
      this.back();
      return true;
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isOpen) return;
    const elapsedMs = Math.max(0, this.clockMs() - this.pageShownAtMs);
    this.renderFrame(ctx, Math.floor((elapsedMs / MS_PER_SECOND) * FRAMES_PER_SECOND));
  }

  /**
   * Draws the overlay with the illustration at a chosen frame. `render` passes
   * the live clock; a review harness passes the frame it wants to look at.
   */
  renderFrame(ctx: CanvasRenderingContext2D, frame: number): void {
    if (this.pageIndex >= this.pages.length) return;
    const page = this.pages[this.pageIndex];
    const vw = viewportWidth();
    const vh = viewportHeight();

    drawOverlay(ctx, { canvasWidth: vw, canvasHeight: vh, alpha: OVERLAY_ALPHA });
    occludeRenderedButtons();

    const fullFit = fitPanel(PANEL_W, PANEL_H);
    const compactPanelH = PANEL_H - ILLUSTRATION_H + ILLUSTRATION_H_COMPACT;
    const compactFit = fitPanel(PANEL_W, compactPanelH);
    // Only when height is what binds: a narrow portrait screen scales the same
    // either way, and shrinking the picture there would cost art for nothing.
    const useCompact = compactFit.scale > fullFit.scale;
    this.fit = useCompact ? compactFit : fullFit;
    const panelH = useCompact ? compactPanelH : PANEL_H;
    const illustrationH = useCompact ? ILLUSTRATION_H_COMPACT : ILLUSTRATION_H;
    const panelX = Math.round((vw - PANEL_W) * HALF);
    const panelY = Math.round((vh - panelH) * HALF);

    beginModalFit(ctx, this.fit);
    drawBox(ctx, {
      x: panelX,
      y: panelY,
      width: PANEL_W,
      height: panelH,
      fill: PANEL_FILL,
      border: ACCENT,
      borderWidth: PANEL_BORDER_WIDTH,
      radius: PANEL_RADIUS,
      shadow: true,
    });
    drawBox(ctx, {
      x: panelX + HEADER_INSET,
      y: panelY + HEADER_INSET,
      width: PANEL_W - HEADER_INSET * 2,
      height: HEADER_H,
      fill: HEADER_FILL,
      radius: PANEL_RADIUS,
    });

    const centreX = panelX + PANEL_W * HALF;
    drawText(ctx, this.config.title, {
      x: centreX,
      y: panelY + TITLE_Y,
      size: TITLE_SIZE,
      bold: true,
      color: ACCENT,
      align: 'center',
    });
    drawText(ctx, page.subtitle, {
      x: centreX,
      y: panelY + SUBTITLE_Y,
      size: SUBTITLE_SIZE,
      color: SUBTITLE_COLOR,
      align: 'center',
    });

    const band: IllustrationRect = {
      x: panelX + CONTENT_PAD,
      y: panelY + HEADER_H + ILLUSTRATION_TOP_GAP,
      width: PANEL_W - CONTENT_PAD * 2,
      height: illustrationH,
    };
    this.drawBand(ctx, page, band, frame);

    let lineY = band.y + band.height + LINES_TOP_GAP;
    for (const line of page.lines) {
      const style = { size: LINE_SIZE, width: band.width, lineHeight: LINE_HEIGHT };
      drawText(ctx, line, { ...style, x: band.x, y: lineY, color: LINE_COLOR, align: 'center' });
      lineY += measureTextBox(ctx, line, style).lineCount * LINE_HEIGHT + PARAGRAPH_GAP;
    }

    const footerY = panelY + panelH - FOOTER_BOTTOM_PAD - FOOTER_BTN_H;
    this.drawPageDots(ctx, centreX, footerY + FOOTER_BTN_H * HALF);

    // The buttons are drawn inside the same pivot-centred scale as the panel, and
    // the pointer space is declared to match, so their hover, their click sound
    // and the focus ring's synthesized click all land where they are drawn.
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);
    const isFirst = this.pageIndex === 0;
    const isLast = this.pageIndex >= this.pages.length - 1;
    beginMenuFocus(this.config.focusId);
    this.backButton = drawButton(ctx, {
      ...BUTTON_PRESETS.primary,
      x: panelX + CONTENT_PAD,
      y: footerY,
      width: FOOTER_BTN_W,
      height: FOOTER_BTN_H,
      label: isFirst ? SKIP_LABEL : BACK_LABEL,
      labelSize: FOOTER_LABEL_SIZE,
    });
    this.nextButton = drawButton(ctx, {
      ...(isLast ? BUTTON_PRESETS.success : BUTTON_PRESETS.blue),
      x: panelX + PANEL_W - CONTENT_PAD - FOOTER_BTN_W,
      y: footerY,
      width: FOOTER_BTN_W,
      height: FOOTER_BTN_H,
      label: isLast ? this.config.finalLabel : NEXT_LABEL,
      labelSize: FOOTER_LABEL_SIZE,
      primaryAction: true,
    });
    endMenuFocus();
    resetButtonPointerSpace();
    endModalFit(ctx);
  }

  private drawBand(
    ctx: CanvasRenderingContext2D,
    page: HowToPlayPage,
    band: IllustrationRect,
    frame: number,
  ): void {
    drawBox(ctx, { ...band, fill: BAND_FILL, border: BAND_BORDER, borderWidth: 1 });
    ctx.save();
    ctx.beginPath();
    ctx.rect(band.x, band.y, band.width, band.height);
    ctx.clip();
    page.drawIllustration(ctx, band, frame);
    ctx.restore();
  }

  private drawPageDots(ctx: CanvasRenderingContext2D, centreX: number, y: number): void {
    const rowWidth = (this.pages.length - 1) * DOT_GAP;
    ctx.save();
    for (let i = 0; i < this.pages.length; i++) {
      ctx.fillStyle = i === this.pageIndex ? ACCENT : DOT_IDLE;
      ctx.beginPath();
      ctx.arc(centreX - rowWidth * HALF + i * DOT_GAP, y, DOT_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  private showPage(index: number): void {
    this.pageIndex = index;
    this.pageShownAtMs = this.clockMs();
    this.audio?.play('typing_click');
  }
}
