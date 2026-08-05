/**
 * The modal shown when the player reads something they found in a building — a
 * ledger, a letter, a tally board (see `townReadables.ts`). Built as a page from
 * the object itself: a title, a line saying where the thing physically is, and
 * the text laid out in paragraphs.
 *
 * It **pages** rather than clipping. The panel can only be as tall as the
 * viewport allows, and a five-paragraph readable does not fit a phone held
 * sideways — but every readable in this game keeps its payload in the *last*
 * paragraph (the embossed column of names, the feather in black wax, "I write
 * them down"), so hiding the overflow would quietly throw away the only line
 * that mattered. Instead the body is broken across as many pages as it takes and
 * advancing walks them, the way `CitizenDialog` walks a conversation.
 *
 * The owning scene drives open/close and routes Space/Esc/click here through its
 * dialog-priority chain; Escape closes outright, wherever the player has got to.
 */

import { platform } from '../core/Platform';
import { drawModal, drawOverlay, BOX_PRESETS } from './Box';
import { suppressMenuFocus } from './Button';
import { drawText, wrapText, TEXT_PRESETS } from './TextBox';
import type { Readable } from '../systems/townReadables';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const PANEL_MAX_WIDTH = 460;
/** Gap kept between the panel and the screen edges on phones narrower than the ideal width. */
const PANEL_SIDE_MARGIN = 10;
const PANEL_PADDING = 20;
const PANEL_MAX_HEIGHT_FRACTION = 0.92;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.6;

const TITLE_SIZE = 17;
const WHERE_SIZE = 10;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 16;

const HEADER_HEIGHT = 44;
/** The closing hint's own line. */
const FOOTER_HINT_HEIGHT = 24;
/**
 * The page counter's line, above the hint.
 *
 * Reserved whether or not a counter is drawn, and — critically — subtracted from
 * the pagination budget as well as added to the panel height. Reserving it in
 * only one of those two places is what put the counter on top of the last line
 * of body text the first time this was written.
 */
const FOOTER_COUNTER_HEIGHT = 19;
const FOOTER_HEIGHT = FOOTER_HINT_HEIGHT + FOOTER_COUNTER_HEIGHT;
const PARAGRAPH_GAP = 9;

const TITLE_COLOR = '#e7d9b0';
const WHERE_COLOR = '#8d8368';
const BODY_COLOR = '#d8d3c4';
const PAGE_COUNT_COLOR = '#8d8368';

interface LaidOutParagraph {
  lines: string[];
  height: number;
}

/** One screenful of paragraphs, and how tall it came out. */
interface ReadablePage {
  paragraphs: LaidOutParagraph[];
  height: number;
}

export class ReadablePanel {
  private readable: Readable | null = null;
  private pageIndex = 0;

  get isOpen(): boolean {
    return this.readable !== null;
  }

  openWith(readable: Readable): void {
    this.readable = readable;
    this.pageIndex = 0;
  }

  close(): void {
    this.readable = null;
    this.pageIndex = 0;
  }

  /**
   * Advances to the next page, or closes on the last one. Returns whether it was
   * consumed, so a click that only turned a page does not also fall through.
   */
  advance(): boolean {
    if (this.readable === null) return false;
    // The page count depends on the viewport, which can change between frames,
    // so the last page is recognised by "nothing follows it" rather than by a
    // count captured when the panel opened.
    if (this.pageIndex + 1 >= this.pageCount()) {
      this.close();
      return true;
    }
    this.pageIndex++;
    return true;
  }

  /** Any click while open turns a page or dismisses. Returns whether consumed. */
  handleClick(): boolean {
    return this.advance();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const readable = this.readable;
    if (readable === null) return;
    suppressMenuFocus('readable');

    const panelWidth = this.panelWidth();
    const pages = this.paginate(ctx, readable, panelWidth);
    // Clamped rather than trusted: the viewport can shrink between the frame
    // that turned to this page and the frame that draws it.
    const index = Math.min(this.pageIndex, pages.length - 1);
    const page = pages[index];
    const height = HEADER_HEIGHT + page.height + FOOTER_HEIGHT + PANEL_PADDING;

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });
    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      ...BOX_PRESETS.modal,
      width: panelWidth,
      height,
      radius: PANEL_RADIUS,
      shadow: true,
    });

    const centerX = modal.x + modal.width / 2;
    drawText(ctx, readable.title, {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: TITLE_COLOR,
      align: 'center',
      outline: true,
    });
    drawText(ctx, readable.where, {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING + TITLE_SIZE + WHERE_SIZE,
      size: WHERE_SIZE,
      color: WHERE_COLOR,
      align: 'center',
    });

    let y = modal.inner.y + PANEL_PADDING + HEADER_HEIGHT;
    for (const paragraph of page.paragraphs) {
      drawText(ctx, paragraph.lines.join('\n'), {
        x: modal.inner.x + PANEL_PADDING,
        y,
        size: BODY_SIZE,
        color: BODY_COLOR,
        lineHeight: BODY_LINE_HEIGHT,
        width: panelWidth - PANEL_PADDING * 2,
      });
      y += paragraph.height + PARAGRAPH_GAP;
    }

    this.renderFooter(ctx, centerX, modal.y + height - FOOTER_HINT_HEIGHT, index, pages.length);
  }

  private renderFooter(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    y: number,
    index: number,
    total: number,
  ): void {
    // Escape always closes outright, so the hint says so rather than implying it
    // turns a page like Space does.
    const onLastPage = index + 1 >= total;
    const hint = platform.isMobile
      ? `TAP to ${onLastPage ? 'put it down' : 'read on'}`
      : onLastPage
        ? 'SPACE / ESC to put it down'
        : 'SPACE to read on  ·  ESC to put it down';
    drawText(ctx, hint, { x: centerX, y, align: 'center', ...TEXT_PRESETS.muted });
    if (total <= 1) return;
    drawText(ctx, `${index + 1} / ${total}`, {
      x: centerX,
      y: y - FOOTER_COUNTER_HEIGHT,
      size: WHERE_SIZE,
      color: PAGE_COUNT_COLOR,
      align: 'center',
    });
  }

  /** The drawn width — never `PANEL_MAX_WIDTH`, which `drawModal` clamps on a phone. */
  private panelWidth(): number {
    return Math.min(PANEL_MAX_WIDTH, viewportWidth() - PANEL_SIDE_MARGIN * 2);
  }

  /** How many pages the current viewport breaks this readable into. */
  private pageCount(): number {
    const readable = this.readable;
    if (readable === null) return 0;
    // Measured off a scratch context rather than the render one, because
    // `advance` runs from input handling where no frame is in flight. Only text
    // metrics are read, so the canvas is never drawn to.
    const ctx = measuringContext();
    if (ctx === null) return 1;
    return this.paginate(ctx, readable, this.panelWidth()).length;
  }

  /**
   * Breaks the body into pages that each fit the viewport. A paragraph taller
   * than a whole page still gets its own page rather than being dropped — it
   * will overrun, which is visible, instead of vanishing, which is not.
   */
  private paginate(
    ctx: CanvasRenderingContext2D,
    readable: Readable,
    panelWidth: number,
  ): ReadablePage[] {
    const bodyBudget =
      viewportHeight() * PANEL_MAX_HEIGHT_FRACTION - HEADER_HEIGHT - FOOTER_HEIGHT - PANEL_PADDING;
    const laidOut = this.layout(ctx, readable, panelWidth - PANEL_PADDING * 2);

    const pages: ReadablePage[] = [];
    let current: ReadablePage = { paragraphs: [], height: 0 };
    for (const paragraph of laidOut) {
      const grown = current.height + paragraph.height + PARAGRAPH_GAP;
      if (current.paragraphs.length > 0 && grown > bodyBudget) {
        pages.push(current);
        current = { paragraphs: [], height: 0 };
      }
      current.paragraphs.push(paragraph);
      current.height += paragraph.height + PARAGRAPH_GAP;
    }
    pages.push(current);
    return pages;
  }

  private layout(
    ctx: CanvasRenderingContext2D,
    readable: Readable,
    bodyWidth: number,
  ): LaidOutParagraph[] {
    ctx.save();
    ctx.font = `${BODY_SIZE}px monospace`;
    const paragraphs = readable.body.map((text) => {
      const lines = wrapText(ctx, text, bodyWidth);
      return { lines, height: lines.length * BODY_LINE_HEIGHT };
    });
    ctx.restore();
    return paragraphs;
  }
}

/**
 * A canvas used only to measure text. Built once and kept, because paginating
 * asks for metrics outside the render pass and allocating a canvas per keypress
 * is the kind of cost that only shows up on the slowest device in the room.
 */
let measuringCanvas: HTMLCanvasElement | null = null;

function measuringContext(): CanvasRenderingContext2D | null {
  measuringCanvas ??= document.createElement('canvas');
  return measuringCanvas.getContext('2d');
}
