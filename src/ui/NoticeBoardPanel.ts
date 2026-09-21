/**
 * The modal shown when the player reads the town square's notice board. It lists
 * the current postings (see `townNotices.ts`) as a scannable board: each posting
 * gets a colored tone tag (DANGER / ACTIVE / OPEN / DONE), a title, and a short
 * body. The panel is passive — any click, Space, or Esc dismisses it; the owning
 * scene drives open/close and routes those keys through its dialog-priority chain.
 */

import { platform } from '../core/Platform';
import { drawModal, drawOverlay, drawScrollbar, BOX_PRESETS } from './Box';
import { suppressMenuFocus } from './Button';
import { drawText, wrapText, TEXT_PRESETS } from './TextBox';
import type { Notice, NoticeTone } from '../systems/townNotices';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const PANEL_WIDTH = 440;
/** Gap kept between the panel and the screen edges on phones narrower than the ideal width. */
const PANEL_SIDE_MARGIN = 8;
const PANEL_PADDING = 20;
/** Fraction of the visible list a tap scrolls, so the last line of the old page stays as a landmark. */
const TAP_SCROLL_FRACTION = 0.85;
const WHEEL_SCROLL_SCALE = 0.5;
const SCROLLBAR_INSET = 8;
const PANEL_MAX_HEIGHT_FRACTION = 0.92;

const TITLE_SIZE = 18;
const NOTICE_TITLE_SIZE = 13;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 15;

const HEADER_HEIGHT = 34;
const FOOTER_HEIGHT = 24;
const NOTICE_GAP = 14;
const NOTICE_TITLE_HEIGHT = 18;
const TAG_TO_TITLE_GAP = 8;
const TAG_WIDTH = 54;
const TAG_HEIGHT = 15;
const TAG_TEXT_SIZE = 9;
const TAG_RADIUS = 3;
const TAG_ALPHA = 0.85;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.55;

interface ToneStyle {
  label: string;
  color: string;
}

const TONE_STYLES: Record<NoticeTone, ToneStyle> = {
  danger: { label: 'DANGER', color: '#ef4444' },
  active: { label: 'ACTIVE', color: '#facc15' },
  available: { label: 'OPEN', color: '#4ade80' },
  done: { label: 'DONE', color: '#64748b' },
};

interface LaidOutNotice {
  notice: Notice;
  lines: string[];
  height: number;
}

export class NoticeBoardPanel {
  private notices: Notice[] = [];
  private open = false;
  private scrollY = 0;
  private maxScrollY = 0;
  private visibleHeight = 0;

  get isOpen(): boolean {
    return this.open;
  }

  openWith(notices: ReadonlyArray<Notice>): void {
    this.notices = [...notices];
    this.open = true;
    this.scrollY = 0;
  }

  close(): void {
    this.open = false;
  }

  /**
   * A tap pages down while postings remain below the fold and dismisses once the
   * bottom is showing, so a phone can read every posting without a drag gesture.
   * Returns whether it was consumed.
   */
  handleClick(): boolean {
    if (!this.open) return false;
    if (this.scrollY < this.maxScrollY) {
      this.scrollBy(this.visibleHeight * TAP_SCROLL_FRACTION);
      return true;
    }
    this.close();
    return true;
  }

  handleWheel(deltaY: number): void {
    if (this.open) this.scrollBy(deltaY * WHEEL_SCROLL_SCALE);
  }

  private scrollBy(delta: number): void {
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + delta));
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.open) return;
    suppressMenuFocus('notice-board');

    const panelWidth = Math.min(PANEL_WIDTH, viewportWidth() - PANEL_SIDE_MARGIN * 2);
    const bodyWidth = panelWidth - PANEL_PADDING * 2;
    const laidOut = this.layout(ctx, bodyWidth);
    const contentHeight = laidOut.reduce((sum, n) => sum + n.height + NOTICE_GAP, 0);
    const fullHeight = HEADER_HEIGHT + contentHeight + FOOTER_HEIGHT + PANEL_PADDING;
    const height = Math.min(fullHeight, viewportHeight() * PANEL_MAX_HEIGHT_FRACTION);

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });
    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: panelWidth,
      height,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
    });

    const left = modal.inner.x + PANEL_PADDING;
    drawText(ctx, 'TOWN NOTICE BOARD', {
      x: modal.x + panelWidth / 2,
      y: modal.inner.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: '#f1f5f9',
      align: 'center',
      outline: true,
    });

    const listTop = modal.inner.y + PANEL_PADDING + HEADER_HEIGHT;
    const listBottom = modal.y + height - FOOTER_HEIGHT;
    this.visibleHeight = listBottom - listTop;
    this.maxScrollY = Math.max(0, contentHeight - this.visibleHeight);
    this.scrollY = Math.min(this.scrollY, this.maxScrollY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(modal.x, listTop, panelWidth, this.visibleHeight);
    ctx.clip();
    let y = listTop - this.scrollY;
    for (const item of laidOut) {
      this.renderNotice(ctx, item, left, y, bodyWidth);
      y += item.height + NOTICE_GAP;
    }
    ctx.restore();
    drawScrollbar(ctx, {
      x: modal.x + panelWidth - SCROLLBAR_INSET,
      trackY: listTop,
      trackH: this.visibleHeight,
      contentH: contentHeight,
      scrollY: this.scrollY,
    });

    const hasMore = this.scrollY < this.maxScrollY;
    const tapHint = hasMore ? 'TAP for more' : 'TAP to close';
    const closeHint = platform.isMobile ? tapHint : 'SPACE / ESC to close';
    drawText(ctx, closeHint, {
      x: modal.x + panelWidth / 2,
      y: modal.y + height - FOOTER_HEIGHT,
      align: 'center',
      ...TEXT_PRESETS.muted,
    });
  }

  private layout(ctx: CanvasRenderingContext2D, bodyWidth: number): LaidOutNotice[] {
    ctx.save();
    ctx.font = `${BODY_SIZE}px monospace`;
    const laidOut = this.notices.map((notice) => {
      const lines = wrapText(ctx, notice.body, bodyWidth);
      const height = NOTICE_TITLE_HEIGHT + lines.length * BODY_LINE_HEIGHT;
      return { notice, lines, height };
    });
    ctx.restore();
    return laidOut;
  }

  private renderNotice(
    ctx: CanvasRenderingContext2D,
    item: LaidOutNotice,
    left: number,
    top: number,
    bodyWidth: number,
  ): void {
    const style = TONE_STYLES[item.notice.tone];
    const tagY = top + (NOTICE_TITLE_HEIGHT - TAG_HEIGHT) / 2;

    ctx.save();
    ctx.fillStyle = style.color;
    ctx.globalAlpha = TAG_ALPHA;
    ctx.beginPath();
    ctx.roundRect(left, tagY, TAG_WIDTH, TAG_HEIGHT, TAG_RADIUS);
    ctx.fill();
    ctx.restore();

    drawText(ctx, style.label, {
      x: left + TAG_WIDTH / 2,
      y: tagY + (TAG_HEIGHT - TAG_TEXT_SIZE) / 2,
      size: TAG_TEXT_SIZE,
      bold: true,
      color: '#0f172a',
      align: 'center',
    });

    drawText(ctx, item.notice.title, {
      x: left + TAG_WIDTH + TAG_TO_TITLE_GAP,
      y: top,
      size: NOTICE_TITLE_SIZE,
      bold: true,
      color: style.color,
    });

    drawText(ctx, item.lines.join('\n'), {
      x: left,
      y: top + NOTICE_TITLE_HEIGHT,
      size: BODY_SIZE,
      color: '#cbd5e1',
      lineHeight: BODY_LINE_HEIGHT,
      width: bodyWidth,
    });
  }
}
