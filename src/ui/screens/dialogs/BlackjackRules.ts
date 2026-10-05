/**
 * The blackjack rules sheet: opened by the table's "How to Play" button and
 * shown by the table itself the first time a player sits down in a visit.
 * Each page shows its rule with the table's own cards. The strategy-hints
 * toggle sits on every page, because a setting found only after eight pages
 * may as well not exist.
 */

import type { Surface } from '../../core/UiRoot';
import {
  BLACKJACK_RULES_PAGES,
  drawBlackjackIllustration,
} from '../../icons/explainerArt/blackjackRulesArt';
import { centerIn } from '../../core/geom';
import { button, measureButton } from '../../widgets/button';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';

/** The table's live advice line, which the sheet lets the player switch. */
export interface BlackjackHints {
  readonly enabled: () => boolean;
  readonly toggle: () => void;
}

const ILLUSTRATION_HEIGHT = 150;
const TITLE = 'Blackjack rules';
const DONE_LABEL = 'Done';
/** The way out offered on the first page when the table raised the sheet unasked. */
const SKIP_LABEL = 'Skip';
const HINTS_LABEL = 'Show strategy hints';
/** Space and Enter put the sheet away, the way the table's own keys always have. */
const DISMISS_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

const PAGES: readonly PagedOverlayPage[] = BLACKJACK_RULES_PAGES.map((page) => ({
  title: page.title,
  body: page.body,
  illustration: {
    height: ILLUSTRATION_HEIGHT,
    paint: (ctx, rect) =>
      drawBlackjackIllustration(ctx, page.illustration, rect.x, rect.y, rect.w, rect.h),
  },
}));

export class BlackjackRules {
  private open = false;
  private page = 0;
  private autoShown = false;

  get isOpen(): boolean {
    return this.open;
  }

  get currentPage(): number {
    return this.page;
  }

  /**
   * @param autoShown True when the table opened this itself on the player's
   *   first sit-down. That run offers Skip, a way out of a tutorial nobody
   *   asked for that does not read as "close and lose your place".
   */
  show(autoShown = false): void {
    this.open = true;
    this.page = 0;
    this.autoShown = autoShown;
  }

  dismiss(): void {
    this.open = false;
  }

  /** Next: forward a page, and close off the last one. */
  advance(): void {
    if (!this.open) return;
    if (this.page >= PAGES.length - 1) {
      this.dismiss();
      return;
    }
    this.page++;
  }

  /** Modal over the table, halting; Escape, Space, Enter and ✕ put it away. */
  surface(id: string, hints: BlackjackHints): Surface {
    const skipLabel = (): string | undefined => (this.autoShown ? SKIP_LABEL : undefined);
    const inner = pagedOverlaySurface({
      id,
      title: TITLE,
      pages: PAGES,
      width: 'md',
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
      accessory: {
        height: (ui) => ui.theme.size.control,
        draw: (ui, rect) => {
          const enabled = hints.enabled();
          const naturalW = measureButton(ui, { label: HINTS_LABEL, icon: 'check' });
          const toggle = centerIn(rect, Math.min(rect.w, naturalW), rect.h);
          button(ui, toggle, {
            id: `${id}/hints`,
            label: HINTS_LABEL,
            icon: enabled ? 'check' : undefined,
            selected: enabled,
            variant: 'secondary',
            onTap: () => hints.toggle(),
          });
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
