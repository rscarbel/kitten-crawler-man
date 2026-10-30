/**
 * A notice board (the town square's or Briar Hollow's): the current postings
 * as a scannable list, each with a tone tag (DANGER / ACTIVE / OPEN / DONE),
 * a title and a short body; a bare board says so. A tap on the list pages
 * down while postings remain below the fold and puts the board away once the
 * bottom is showing, so a phone can read
 * every posting without a drag; Space (its Close button) and Escape put it
 * away at once. A board may also offer one action, such as tearing off a
 * work order. It is never what Space picks: taking a job is a deliberate
 * press, since a held contract can only be dropped at Wendell's.
 */

import type { Notice, NoticeTone } from '../../../systems/townNotices';
import type { Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import type { Theme } from '../../theme/tokens';
import { badge, badgeSize, type BadgeTone } from '../../widgets/badge';
import { panel, panelBodyWidth, type FooterButton } from '../../widgets/panel';
import { scrollIntoView, scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';

const TITLE = 'Town notice board';
export const VILLAGE_TITLE = 'Village notice board';
const CLOSE_LABEL = 'Close';
const BARE_BOARD_LINE = 'Nothing is pinned up yet. Only old tack holes and a curl of torn paper.';
/** Share of the visible list a tap scrolls, so the last line of the old page stays as a landmark. */
const TAP_SCROLL_FRACTION = 0.85;
/** A scroll this close to its end counts as the bottom, in UI units. */
const BOTTOM_TOLERANCE = 0.5;

interface ToneStyle {
  readonly label: string;
  readonly badge: BadgeTone;
}

const TONE_STYLES: Record<NoticeTone, ToneStyle> = {
  danger: { label: 'DANGER', badge: 'danger' },
  active: { label: 'ACTIVE', badge: 'warning' },
  available: { label: 'OPEN', badge: 'success' },
  done: { label: 'DONE', badge: 'neutral' },
};

/** The one thing a board can be asked to do besides being read. */
export interface NoticeBoardAction {
  readonly label: string;
  readonly onTap: () => void;
}

export interface NoticeBoardOptions {
  /** Defaults to the town square's board. */
  readonly title?: string;
  readonly action?: NoticeBoardAction | null;
}

function toneColor(theme: Theme, tone: NoticeTone): string {
  const { palette } = theme;
  switch (tone) {
    case 'danger':
      return palette.state.danger;
    case 'active':
      return palette.state.warning;
    case 'available':
      return palette.state.success;
    case 'done':
      return palette.text.muted;
  }
}

function headerHeight(ui: Ui): number {
  return Math.max(lineHeightOf(ui, 'title'), badgeSize(ui, { label: 'DANGER', kind: 'tag' }).h);
}

function noticeHeight(ui: Ui, notice: Notice, width: number): number {
  return (
    headerHeight(ui) +
    ui.theme.space.xs +
    measureTextHeight(ui, width, { text: notice.body, role: 'secondary' })
  );
}

function drawNotice(ui: Ui, notice: Notice, row: Rect): void {
  const { space } = ui.theme;
  const style = TONE_STYLES[notice.tone];
  const headH = headerHeight(ui);
  const tag = badgeSize(ui, { label: style.label, kind: 'tag' });
  badge(
    ui,
    { x: row.x, y: row.y, w: tag.w, h: headH },
    { label: style.label, kind: 'tag', tone: style.badge },
  );
  const titleX = row.x + tag.w + space.sm;
  text(
    ui,
    { x: titleX, y: row.y, w: row.x + row.w - titleX, h: headH },
    { text: notice.title, role: 'title', color: toneColor(ui.theme, notice.tone) },
  );
  const bodyY = row.y + headH + space.xs;
  text(
    ui,
    { x: row.x, y: bodyY, w: row.w, h: row.y + row.h - bodyY },
    { text: notice.body, role: 'secondary', wrap: true },
  );
}

export class NoticeBoard {
  private notices: readonly Notice[] = [];
  private title = TITLE;
  private action: NoticeBoardAction | null = null;
  private open = false;
  private pageDownPending = false;
  /** Whether the last frame showed the bottom of the list. */
  private atBottom = true;

  get isOpen(): boolean {
    return this.open;
  }

  openWith(notices: readonly Notice[], options: NoticeBoardOptions = {}): void {
    this.notices = [...notices];
    this.title = options.title ?? TITLE;
    this.action = options.action ?? null;
    this.open = true;
    this.pageDownPending = false;
    this.atBottom = true;
  }

  close(): void {
    this.open = false;
  }

  /** A tap on the list: page down while postings remain, else put the board away. Returns whether consumed. */
  handleClick(): boolean {
    if (!this.open) return false;
    if (this.atBottom) this.close();
    else this.pageDownPending = true;
    return true;
  }

  private footer(): FooterButton[] {
    const closeButton = { label: CLOSE_LABEL, primary: true, onTap: () => this.close() };
    const action = this.action;
    if (action === null) return [{ ...closeButton, variant: 'primary' }];
    return [
      { label: action.label, variant: 'primary', onTap: action.onTap },
      { ...closeButton, variant: 'secondary' },
    ];
  }

  /** Modal and halting; Escape, ✕, Space and Close put it away. */
  surface(id = 'notice-board'): Surface {
    const listId = `${id}/list`;
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.open,
      close: () => this.close(),
      render: (ui) => {
        const { space } = ui.theme;
        const width = 'md';
        const listW = panelBodyWidth(ui, width) - scrollGutterWidth(ui);
        const heights = this.notices.map((notice) => noticeHeight(ui, notice, listW));
        const bare = this.notices.length === 0;
        const bareLine = { text: BARE_BOARD_LINE, role: 'secondary' } as const;
        const noticesHeight =
          heights.reduce((sum, h) => sum + h, 0) + space.lg * Math.max(0, heights.length - 1);
        const contentHeight = bare ? measureTextHeight(ui, listW, bareLine) : noticesHeight;
        const p = panel(ui, {
          id,
          title: this.title,
          width,
          height: 'content',
          contentHeight,
          onClose: () => this.close(),
          onScrimTap: () => void this.handleClick(),
          footer: this.footer(),
        });
        const result = scrollView(ui, p.body, {
          id: listId,
          contentHeight,
          draw: (content) => {
            ui.hit(`${id}/page`, content, {
              onTap: () => void this.handleClick(),
              focusable: false,
              sound: null,
            });
            if (bare) text(ui, content, { ...bareLine, wrap: true });
            let y = content.y;
            this.notices.forEach((notice, index) => {
              const h = heights[index] ?? 0;
              drawNotice(ui, notice, { x: content.x, y, w: content.w, h });
              y += h + space.lg;
            });
          },
        });
        if (this.pageDownPending) {
          this.pageDownPending = false;
          const step = p.body.h * TAP_SCROLL_FRACTION;
          const nextTop = result.offset + step;
          scrollIntoView(ui, listId, nextTop, nextTop + p.body.h, p.body.h);
        }
        this.atBottom = result.offset >= result.maxOffset - BOTTOM_TOLERANCE;
      },
    };
  }
}
