/**
 * What the player reads when they pick up something found in a building (a
 * ledger, a letter, a tally board): its title, where it physically is, and
 * its text.
 *
 * It pages rather than scrolling to a cut-off. Every readable keeps its
 * payload in its last paragraph, so a body too tall for the screen is broken
 * across as many pages as it takes and advancing walks them. The page count
 * depends on the screen, so it is worked out each frame. Any tap, Space,
 * Enter or the attack key reads on and the last page puts it down; Escape puts it down from anywhere.
 */

import type { Readable } from '../../../systems/townReadables';
import { keybindings } from '../../../core/Keybindings';
import { ACTIVATE_KEYS, type Surface, type Ui } from '../../core/UiRoot';
import { panelBodyMaxHeight, panelBodyWidth } from '../../widgets/panel';
import {
  pagedOverlayChromeHeight,
  pagedOverlayPageHeight,
  pagedOverlaySurface,
  type PagedOverlayPage,
} from '../../widgets/pagedOverlay';
import type { PanelWidth } from '../../theme/tokens';

const WIDTH: PanelWidth = 'md';
const READ_ON_LABEL = 'Read on';
const DONE_LABEL = 'Put it down';
const PARAGRAPH_BREAK = '\n\n';

export class ReadableOverlay {
  private readable: Readable | null = null;
  private page = 0;
  /** As many pages as the last frame drew; input always follows a frame. */
  private pageCount = 1;
  private pages: readonly PagedOverlayPage[] = [];

  get isOpen(): boolean {
    return this.readable !== null;
  }

  get currentPage(): number {
    return this.page;
  }

  openWith(readable: Readable): void {
    this.readable = readable;
    this.page = 0;
    this.pageCount = 1;
    this.pages = [];
  }

  close(): void {
    this.readable = null;
    this.page = 0;
  }

  /** Reads on a page, or puts it down on the last. Returns whether it was open. */
  advance(): boolean {
    if (this.readable === null) return false;
    if (this.page + 1 >= this.pageCount) {
      this.close();
      return true;
    }
    this.page++;
    return true;
  }

  /** Breaks the body into pages that each fit this screen without scrolling. */
  private paginate(ui: Ui, readable: Readable): readonly PagedOverlayPage[] {
    const width = panelBodyWidth(ui, WIDTH);
    const budget =
      panelBodyMaxHeight(ui, { width: WIDTH, onClose: () => undefined }) -
      pagedOverlayChromeHeight(ui, {});
    const pageOf = (paragraphs: readonly string[]): PagedOverlayPage => ({
      title: readable.title,
      overline: readable.where,
      body: paragraphs.join(PARAGRAPH_BREAK),
    });
    const groups: string[][] = [];
    let current: string[] = [];
    for (const paragraph of readable.body) {
      const grown = [...current, paragraph];
      if (current.length > 0 && pagedOverlayPageHeight(ui, pageOf(grown), width) > budget) {
        groups.push(current);
        current = [paragraph];
      } else {
        current = grown;
      }
    }
    groups.push(current);
    return groups.map(pageOf);
  }

  /** Modal and halting; any tap, Space, Enter or the attack key reads on, Escape or ✕ puts it down. */
  surface(id = 'readable'): Surface {
    const pages = (): readonly PagedOverlayPage[] => this.pages;
    const inner = pagedOverlaySurface({
      id,
      get pages(): readonly PagedOverlayPage[] {
        return pages();
      },
      width: WIDTH,
      nextLabel: READ_ON_LABEL,
      doneLabel: DONE_LABEL,
      back: false,
      arrowKeys: false,
      advanceOnTapAnywhere: true,
      navSound: null,
      onDone: () => this.close(),
      isOpen: () => this.isOpen,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      pager: {
        page: () => this.page,
        setPage: (next) => {
          if (next > this.page) this.advance();
        },
      },
    });
    return {
      ...inner,
      onKey: (key, mods) => {
        const isAttack = keybindings.actionFor(key) === 'attack';
        if (!isAttack || ACTIVATE_KEYS.has(key)) return inner.onKey?.(key, mods) ?? false;
        if (mods.repeat !== true && mods.predatesSurface !== true) this.advance();
        return true;
      },
      render: (ui) => {
        const readable = this.readable;
        if (readable === null) return;
        this.pages = this.paginate(ui, readable);
        this.pageCount = this.pages.length;
        this.page = Math.min(this.page, this.pageCount - 1);
        inner.render(ui);
      },
    };
  }
}
