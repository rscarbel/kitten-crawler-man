/**
 * The Keyboard Hero tutorial raised in the spider's lab before a hack: falling
 * notes, then a hit beside a miss, the first time a hack is played this
 * session. The quest owns the page and plays the click itself; the
 * last page's button starts the hack, and Escape (or ✕) retreats to the
 * terminal.
 */

import type { Rect } from '../../core/geom';
import type { Surface } from '../../core/UiRoot';
import type { IllustrationRect } from '../../icons/explainerArt/illustration';
import { drawFallingNotesPage, drawHitMissPage } from '../../icons/explainerArt/spiderTutorialArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { paintInDesignSpace, type DesignSize } from './explainerPages';

/** One page of the tutorial. */
export type SpiderTutorialPageId = 'falling-notes' | 'hit-miss';

/** The pages the tutorial teaches, in the order they are shown. */
const BASE_PAGE_IDS: readonly SpiderTutorialPageId[] = ['falling-notes', 'hit-miss'];

/** Pages already shown this session; module state, so a reload teaches it all again. */
const pagesSeenThisSession = new Set<SpiderTutorialPageId>();

/**
 * The pages a hack still has to show this session, in order. Empty when there
 * is nothing left to teach and the hack can start at once.
 */
export function spiderTutorialPagesDue(): readonly SpiderTutorialPageId[] {
  return BASE_PAGE_IDS.filter((page) => !pagesSeenThisSession.has(page));
}

/** Records `pages` as shown, so later hacks this session skip them. */
export function markSpiderTutorialPagesSeen(pages: readonly SpiderTutorialPageId[]): void {
  for (const page of pages) pagesSeenThisSession.add(page);
}

/** What the tutorial reads from, and drives on, `SpiderQuestSystem`. */
export interface SpiderTutorialModel {
  readonly isKeyboardHeroTutorialOpen: boolean;
  /** The pages this showing walks through; the base pages when not given. */
  readonly tutorialPages?: readonly SpiderTutorialPageId[];
  readonly tutorialPageIndex: number;
  /** Turns the page, or on the last one starts the hack. Plays its own click. */
  advanceTutorial(): void;
  /** Escape: retreat to the terminal. */
  dismissDialog(): boolean;
}

/** The band the board and its callouts were laid out for. */
const BOARD_DESIGN: DesignSize = { width: 484, height: 260 };
/** The board and its lane controls alone, for a band too narrow to hold the callouts legibly. */
const BOARD_ONLY_DESIGN: DesignSize = { width: 220, height: 260 };
/**
 * A band narrower than this (width over height) draws the board alone, and
 * larger: scaled to fit with its callouts, their text would be unreadable.
 */
const CALLOUTS_MIN_ASPECT = 1.5;
/** Beside the page's text the board stands alone, so its column is only as wide as the board. */
const BOARD_ONLY_ASPECT = BOARD_ONLY_DESIGN.width / BOARD_ONLY_DESIGN.height;
const ILLUSTRATION_HEIGHT = 260;
const TITLE = 'How to play';
const GO_LABEL = "Let's Go!";

type BoardPainter = (
  ctx: CanvasRenderingContext2D,
  band: IllustrationRect,
  frame: number,
  callouts: boolean,
) => void;

function paintBoard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pageMs: number,
  paint: BoardPainter,
): void {
  const callouts = rect.w / rect.h >= CALLOUTS_MIN_ASPECT;
  paintInDesignSpace(
    ctx,
    rect,
    callouts ? BOARD_DESIGN : BOARD_ONLY_DESIGN,
    pageMs,
    (c, band, frame) => paint(c, band, frame, callouts),
    'contain',
  );
}

function pages(touch: boolean): Readonly<Record<SpiderTutorialPageId, PagedOverlayPage>> {
  return {
    'falling-notes': {
      title: 'Falling Notes',
      body: [
        'Notes fall down four lanes toward the rings at the bottom.',
        'Strike each one as it reaches its ring — the tighter the timing, the better.',
        touch ? 'Tap the button under a lane to play it.' : 'Keys: A / ← · W / ↑ · S / ↓ · D / →',
      ].join('\n'),
      illustration: {
        height: ILLUSTRATION_HEIGHT,
        aspect: BOARD_ONLY_ASPECT,
        paint: (ctx, rect, _now, pageMs) =>
          paintBoard(ctx, rect, pageMs, (c, band, frame, callouts) =>
            drawFallingNotesPage(c, band, frame, { touch, callouts }),
          ),
      },
    },
    'hit-miss': {
      title: 'Hit vs. Miss',
      body: [
        'A miss breaks a firewall pip and flashes the lane red.',
        'Break both pips and the intrusion is traced — you start over.',
        'Play every note before the track ends and the lab goes dark.',
      ].join('\n'),
      illustration: {
        height: ILLUSTRATION_HEIGHT,
        aspect: BOARD_ONLY_ASPECT,
        paint: (ctx, rect, _now, pageMs) =>
          paintBoard(ctx, rect, pageMs, (c, band, _frame, callouts) =>
            drawHitMissPage(c, band, { callouts }),
          ),
      },
    },
  };
}

const POINTER_PAGES = pages(false);
const TOUCH_PAGES = pages(true);

/** Modal and halting; Space and Enter press the page's one button. */
export function spiderTutorialSurface(model: SpiderTutorialModel, id = 'spider-tutorial'): Surface {
  let touch = false;
  let shownPages: {
    ids: readonly SpiderTutorialPageId[];
    touch: boolean;
    pages: readonly PagedOverlayPage[];
  } | null = null;
  const currentPages = (): readonly PagedOverlayPage[] => {
    const ids = model.tutorialPages ?? BASE_PAGE_IDS;
    if (shownPages?.ids === ids && shownPages.touch === touch) return shownPages.pages;
    const byId = touch ? TOUCH_PAGES : POINTER_PAGES;
    shownPages = { ids, touch, pages: ids.map((page) => byId[page]) };
    return shownPages.pages;
  };
  const advance = (): void => model.advanceTutorial();
  const inner = pagedOverlaySurface({
    id,
    title: TITLE,
    get pages(): readonly PagedOverlayPage[] {
      return currentPages();
    },
    doneLabel: GO_LABEL,
    back: false,
    arrowKeys: false,
    navSound: null,
    onDone: advance,
    onClose: () => void model.dismissDialog(),
    isOpen: () => model.isKeyboardHeroTutorialOpen,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    pager: {
      page: () => model.tutorialPageIndex,
      setPage: (next) => {
        if (next > model.tutorialPageIndex) advance();
      },
    },
  });
  return {
    ...inner,
    render: (ui) => {
      touch = ui.density === 'touch';
      inner.render(ui);
    },
  };
}
