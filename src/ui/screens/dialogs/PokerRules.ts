/**
 * The Texas Hold'em rules sheet: opened by the table's Rules button and shown
 * by the table itself the first time a player sits down in a visit. Each page
 * shows its rule with the table's own cards.
 */

import type { Surface, Ui } from '../../core/UiRoot';
import { POKER_RULES_PAGES, drawPokerIllustration } from '../../icons/explainerArt/pokerRulesArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';

/**
 * Every page asks for the same art height, so the sheet makes the same layout
 * choice on every page of a given screen: a page whose art asked for more
 * would be the one that squeezes or rearranges when turned to. The height
 * grows with the screen up to the share the overlay allows, so the cards are
 * as large as the screen has room for; below the floor, a short landscape
 * screen sets the art beside the text instead.
 */
const MIN_ILLUSTRATION_HEIGHT = 190;
const MAX_ILLUSTRATION_HEIGHT = 340;
/**
 * The cards are the lesson on most pages, so the art may take more of a
 * phone's height than an explainer's usual share; long text scrolls instead.
 */
const ILLUSTRATION_VIEWPORT_SHARE = 0.45;

function illustrationHeight(ui: Ui): number {
  const allowed = ui.viewport.h * ILLUSTRATION_VIEWPORT_SHARE;
  return Math.max(MIN_ILLUSTRATION_HEIGHT, Math.min(MAX_ILLUSTRATION_HEIGHT, allowed));
}
/**
 * Every page's art is a row or a stack of cards, so on a short landscape
 * screen every page sets it beside the text rather than shrinking it away.
 */
const ILLUSTRATION_ASPECT = 2.4;
const TITLE = "Texas Hold'em rules";
const DONE_LABEL = 'Done';
/** The way out offered on the first page when the table raised the sheet unasked. */
const SKIP_LABEL = 'Skip';
/** Space and Enter put the sheet away, the way the blackjack sheet's keys do. */
const DISMISS_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

const RULE_PAGES: readonly PagedOverlayPage[] = POKER_RULES_PAGES.map((page) => ({
  title: page.title,
  body: page.body,
  illustration: {
    height: illustrationHeight,
    maxViewportShare: ILLUSTRATION_VIEWPORT_SHARE,
    aspect: ILLUSTRATION_ASPECT,
    paint: (ctx, rect) =>
      drawPokerIllustration(ctx, page.illustration, rect.x, rect.y, rect.w, rect.h),
  },
}));

export class PokerRules {
  private open = false;
  private page = 0;
  private autoShown = false;

  get isOpen(): boolean {
    return this.open;
  }

  get currentPage(): number {
    return this.page;
  }

  /** How many pages the sheet has. */
  get pageCount(): number {
    return RULE_PAGES.length;
  }

  /**
   * @param autoShown True when the table opened this itself on the player's
   *   first sit-down of a visit. That run offers Skip, a way out of a tutorial
   *   nobody asked for that does not read as "close and lose your place".
   */
  show(autoShown = false): void {
    this.open = true;
    this.page = 0;
    this.autoShown = autoShown;
  }

  /** Opens straight onto `page`, for the gallery and for a host that links to one page. */
  showPage(page: number): void {
    this.show(false);
    this.page = Math.max(0, Math.min(page, this.pageCount - 1));
  }

  dismiss(): void {
    this.open = false;
  }

  /** Modal over the table, halting; Escape, Space, Enter and ✕ put it away. */
  surface(id: string): Surface {
    const skipLabel = (): string | undefined => (this.autoShown ? SKIP_LABEL : undefined);
    const inner = pagedOverlaySurface({
      id,
      title: TITLE,
      pages: RULE_PAGES,
      width: 'lg',
      doneLabel: DONE_LABEL,
      get skipLabel(): string | undefined {
        return skipLabel();
      },
      pageTurnSound: 'typing_click',
      onDone: () => this.dismiss(),
      isOpen: () => this.isOpen,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      pager: {
        page: () => this.page,
        setPage: (page) => {
          this.page = page;
        },
      },
    });
    return {
      ...inner,
      onKey: (key, mods) => {
        if (DISMISS_KEYS.has(key)) {
          if (mods.repeat !== true && mods.predatesSurface !== true) this.dismiss();
          return true;
        }
        return inner.onKey?.(key, mods) ?? false;
      },
    };
  }
}
