/**
 * The two-page Keyboard Hero tutorial raised in the spider's lab the first
 * time the hack starts: falling notes, then a hit beside a miss. The quest
 * owns the page and plays the click itself; the last page's button starts the
 * hack, and Escape (or ✕) retreats to the terminal.
 */

import type { Rect } from '../../core/geom';
import type { Surface } from '../../core/UiRoot';
import type { IllustrationRect } from '../../icons/explainerArt/illustration';
import { drawFallingNotesPage, drawHitMissPage } from '../../icons/explainerArt/spiderTutorialArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { paintInDesignSpace, type DesignSize } from './explainerPages';

/** What the tutorial reads from, and drives on, `SpiderQuestSystem`. */
export interface SpiderTutorialModel {
  readonly isKeyboardHeroTutorialOpen: boolean;
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

function pages(touch: boolean): readonly PagedOverlayPage[] {
  return [
    {
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
    {
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
  ];
}

const POINTER_PAGES = pages(false);
const TOUCH_PAGES = pages(true);

/** Modal and halting; Space and Enter press the page's one button. */
export function spiderTutorialSurface(model: SpiderTutorialModel, id = 'spider-tutorial'): Surface {
  let touch = false;
  const advance = (): void => model.advanceTutorial();
  const inner = pagedOverlaySurface({
    id,
    title: TITLE,
    get pages(): readonly PagedOverlayPage[] {
      return touch ? TOUCH_PAGES : POINTER_PAGES;
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
