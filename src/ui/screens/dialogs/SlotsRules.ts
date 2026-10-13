/**
 * The slot machine's paytable and rules: opened from the machine's Paytable
 * (or ?) button. Every symbol's pay at the current bet, the wild, the
 * scatter and its pay, the twenty paylines and the progressive jackpot.
 */

import type { Surface } from '../../core/UiRoot';
import { SLOTS_RULES_PAGES, drawSlotsIllustration } from '../../icons/explainerArt/slotsRulesArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';

const TITLE = 'Slots paytable';
const DONE_LABEL = 'Done';
/** Space and Enter put the sheet away, the way the machine's own keys always have. */
const DISMISS_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);
/** Wide enough for the paytable's symbols to sit four to a row beside the text. */
const ILLUSTRATION_ASPECT = 1.6;
/** The paytable is the page's point, so it may take more of a short screen than an illustration usually does. */
const ILLUSTRATION_MAX_VIEWPORT_SHARE = 0.45;

export class SlotsRules {
  private open = false;
  private page = 0;
  private readonly pages: readonly PagedOverlayPage[];

  constructor(betPerLine: () => number) {
    this.pages = SLOTS_RULES_PAGES.map((page) => ({
      title: page.title,
      body: page.body,
      illustration: {
        height: page.height,
        aspect: ILLUSTRATION_ASPECT,
        maxViewportShare: ILLUSTRATION_MAX_VIEWPORT_SHARE,
        paint: (ctx, rect) => drawSlotsIllustration(ctx, page.illustration, rect, betPerLine()),
      },
    }));
  }

  get isOpen(): boolean {
    return this.open;
  }

  get currentPage(): number {
    return this.page;
  }

  show(page = 0): void {
    this.open = true;
    this.page = Math.max(0, Math.min(this.pages.length - 1, page));
  }

  dismiss(): void {
    this.open = false;
  }

  /** Modal over the machine, halting; Escape, Space, Enter and ✕ put it away. */
  surface(id: string): Surface {
    const inner = pagedOverlaySurface({
      id,
      title: TITLE,
      pages: this.pages,
      width: 'lg',
      // The machine's lit buttons would otherwise glow through the paytable's text.
      solid: true,
      doneLabel: DONE_LABEL,
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
