/**
 * The "how it works" explainers (the craft skills, village processing and
 * Mongo) behind one handle and one surface.
 *
 * Only one is ever up at a time, and every scene treats whichever it is the
 * same way, so a scene mounts the one surface and anything that gains an
 * explainer later only registers an entry. Registration is keyed by a plain
 * id rather than `CraftSkillId` because not every explainer is a leveled
 * craft skill.
 */

import type { CraftSkillId } from '../../../core/CraftSkills';
import type { Surface } from '../../core/UiRoot';
import {
  pagedOverlaySurface,
  type PagedOverlayPage,
  type PagedOverlaySurfaceConfig,
} from '../../widgets/pagedOverlay';
import type { ExplainerEntry } from './explainerPages';

/** A craft skill's own id, or another process explained the same way. */
export type ExplainerId = CraftSkillId | 'processing' | 'mongo';

export interface CraftExplainersSurfaceOptions {
  /** Defaults to `craft-explainers`. */
  readonly id?: string;
  /** False while something drawn over the explainer (a reward card) should take Escape instead. */
  readonly wantsEscape?: () => boolean;
}

const DEFAULT_SURFACE_ID = 'craft-explainers';
const DONE_LABEL = 'Got it!';
const SKIP_LABEL = 'Skip';

interface OpenExplainer {
  readonly id: ExplainerId;
  readonly entry: ExplainerEntry;
  pages: readonly PagedOverlayPage[] | null;
  page: number;
}

export class CraftExplainers {
  private readonly entries = new Map<ExplainerId, ExplainerEntry>();
  private current: OpenExplainer | null = null;
  /** The last density drawn at, so pages built before a frame still pick the right wording. */
  private touch = false;

  register(id: ExplainerId, entry: ExplainerEntry): void {
    this.entries.set(id, entry);
  }

  /** Opens the explainer for `id` on its first page. Returns false when none is registered under it. */
  open(id: ExplainerId): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.close();
    entry.onOpen?.();
    this.current = { id, entry, pages: null, page: 0 };
    return true;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Which explainer is up, or null. */
  get openId(): ExplainerId | null {
    return this.current?.id ?? null;
  }

  /** Zero-based index of the page on screen. */
  get currentPage(): number {
    return this.current?.page ?? 0;
  }

  get pageCount(): number {
    return this.pages().length;
  }

  close(): void {
    this.current = null;
  }

  /** Next: forward a page, and close off the last one. */
  advance(): void {
    const open = this.current;
    if (open === null) return;
    if (open.page >= this.pages().length - 1) {
      this.close();
      return;
    }
    open.page++;
  }

  private pages(): readonly PagedOverlayPage[] {
    const open = this.current;
    if (open === null) return [];
    open.pages ??= open.entry.pages(this.touch);
    return open.pages;
  }

  /** The one surface every explainer shows on: modal, halting, Escape closes it. */
  surface(opts: CraftExplainersSurfaceOptions = {}): Surface {
    const title = (): string | undefined => this.current?.entry.title;
    const pages = (): readonly PagedOverlayPage[] => this.pages();
    const close = (): void => this.close();
    const pager = {
      page: (): number => this.currentPage,
      setPage: (page: number): void => {
        if (this.current !== null) this.current.page = page;
      },
    };
    const isOpen = (): boolean => this.isOpen;
    const config: PagedOverlaySurfaceConfig = {
      id: opts.id ?? DEFAULT_SURFACE_ID,
      get title(): string | undefined {
        return title();
      },
      get pages(): readonly PagedOverlayPage[] {
        return pages();
      },
      doneLabel: DONE_LABEL,
      skipLabel: SKIP_LABEL,
      pageTurnSound: 'typing_click',
      onDone: close,
      isOpen,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      wantsEscape: opts.wantsEscape,
      pager,
    };
    const inner = pagedOverlaySurface(config);
    return {
      ...inner,
      render: (ui) => {
        this.touch = ui.density === 'touch';
        inner.render(ui);
      },
    };
  }
}
