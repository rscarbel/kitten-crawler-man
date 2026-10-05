/**
 * The goblin mother's three-page tutorial, shown the first time her defend
 * quest is accepted: what the quest asks, building barriers, and the threat.
 * The quest owns the page; the last page's button starts the countdown, and
 * Escape (or ✕) backs out to her waiting for an answer.
 */

import type { Surface } from '../../core/UiRoot';
import {
  drawDefendBuildPage,
  drawDefendQuestPage,
  drawDefendThreatPage,
} from '../../icons/explainerArt/defendTutorialArt';
import type { IllustrationRect } from '../../icons/explainerArt/illustration';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { paintInDesignSpace, type DesignSize } from './explainerPages';

/** What the tutorial reads from, and drives on, `DefendQuestSystem`. */
export interface DefendTutorialModel {
  readonly isTutorialOpen: boolean;
  readonly tutorialPageIndex: number;
  /** Next a page, or on the last one start the countdown. */
  advancePage(): boolean;
  /** Escape: back out to the quest offer. */
  dismissDialog(): boolean;
}

const ILLUSTRATION_HEIGHT = 170;
/** The band the figures and their labels were laid out for; a smaller band scales it down whole. */
const ART_DESIGN: DesignSize = { width: 468, height: 180 };
const GO_LABEL = "Let's Go!";

function page(
  title: string,
  body: string,
  paint: (ctx: CanvasRenderingContext2D, rect: IllustrationRect) => void,
): PagedOverlayPage {
  return {
    title,
    body,
    illustration: {
      height: ILLUSTRATION_HEIGHT,
      paint: (ctx, rect, _now, pageMs) =>
        paintInDesignSpace(ctx, rect, ART_DESIGN, pageMs, (c, band) => paint(c, band), 'contain'),
    },
  };
}

const PAGES: readonly PagedOverlayPage[] = [
  page(
    'The quest',
    'The goblin mother bars the way on while this runs. Keep her alive for 60 seconds — or walk out on it, and the boards come straight down.',
    drawDefendQuestPage,
  ),
  page(
    'Build barriers',
    'Walk over the WOOD PILE to collect boards. Stand by a glowing grate, then press [R] to board it up. Each barrier costs 4 boards.',
    drawDefendBuildPage,
  ),
  page(
    'The threat',
    'Bugaboos crawl up from grates to attack! Barriers hold them — repair any that are clawed. Survive the full timer to complete the quest.',
    drawDefendThreatPage,
  ),
];

/** Modal and halting; Space and Enter press the page's one button. */
export function defendTutorialSurface(model: DefendTutorialModel, id = 'defend-tutorial'): Surface {
  return pagedOverlaySurface({
    id,
    pages: PAGES,
    doneLabel: GO_LABEL,
    back: false,
    arrowKeys: false,
    onDone: () => void model.advancePage(),
    onClose: () => void model.dismissDialog(),
    isOpen: () => model.isTutorialOpen,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    pager: {
      page: () => model.tutorialPageIndex,
      setPage: (next) => {
        if (next > model.tutorialPageIndex) model.advancePage();
      },
    },
  });
}
