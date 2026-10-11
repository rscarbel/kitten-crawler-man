/**
 * The pipe board's four-page explainer, shown the first time any copy of the
 * bathroom's pipe wall is used and again from the board's "How it works":
 * the water main, turning pipes, filling the fixtures, and what counts as
 * done. The bathroom system owns whether it is open; the last page's button
 * goes on to the board, and Escape (or ✕) puts it away.
 */

import { byInputMode } from '../../core/inputMode';
import type { Surface } from '../../core/UiRoot';
import {
  drawPipeFixturesPage,
  drawPipeLeaksPage,
  drawPipeMainPage,
  drawPipeTurnPage,
} from '../../icons/explainerArt/pipeBoardArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { explainerPage } from './explainerPages';

/** What the explainer reads from, and drives on, `CloggedBathroomSystem`. */
export interface PipeBoardExplainerModel {
  readonly isPipeBoardExplainerOpen: boolean;
  /** "Grab the wrench" on the last page: put the explainer away and go to the board. */
  finishPipeBoardExplainer(): void;
  /** Escape or ✕: put the explainer away. */
  dismissPipeBoardExplainer(): void;
}

const TITLE = 'How the pipes work';
const DONE_LABEL = 'Grab the wrench';

function pages(touch: boolean): readonly PagedOverlayPage[] {
  const mode = touch ? 'touch' : 'pointer';
  return [
    explainerPage({
      subtitle: 'The water main',
      lines: [
        'Water comes in from the main on the left.',
        "It runs through every pipe it's connected to. Full pipes glow blue and flow; empty pipes stay grey.",
      ],
      drawIllustration: drawPipeMainPage,
    }),
    explainerPage({
      subtitle: 'Turn the pipes',
      lines: [
        byInputMode(mode, {
          touch: 'Tap a pipe to turn it a quarter turn.',
          pointer: 'Click a pipe to turn it, or pick one with the arrow keys and press Space.',
        }),
        "Brass pipes are bolted down and won't turn.",
      ],
      drawIllustration: (ctx, rect, frame) => drawPipeTurnPage(ctx, rect, frame, touch),
    }),
    explainerPage({
      subtitle: 'Fill every fixture',
      lines: [
        'Every toilet and sink around the edge needs water.',
        'A dry one wears a red tag. A working one fills up and turns green.',
      ],
      drawIllustration: drawPipeFixturesPage,
    }),
    explainerPage({
      subtitle: 'No leaks',
      lines: [
        'An open end on a pipe with water in it sprays everywhere.',
        "The job is done when every toilet and sink is full and nothing leaks. Pipes you don't need can stay dry.",
      ],
      drawIllustration: drawPipeLeaksPage,
    }),
  ];
}

const POINTER_PAGES = pages(false);
const TOUCH_PAGES = pages(true);

/** Modal and halting; the arrows turn its pages, and Space or Enter presses its button. */
export function pipeBoardExplainerSurface(
  model: PipeBoardExplainerModel,
  id = 'pipe-board-explainer',
): Surface {
  let touch = false;
  const inner = pagedOverlaySurface({
    id,
    title: TITLE,
    get pages(): readonly PagedOverlayPage[] {
      return touch ? TOUCH_PAGES : POINTER_PAGES;
    },
    doneLabel: DONE_LABEL,
    onDone: () => model.finishPipeBoardExplainer(),
    onClose: () => model.dismissPipeBoardExplainer(),
    isOpen: () => model.isPipeBoardExplainerOpen,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
  });
  return {
    ...inner,
    render: (ui) => {
      touch = ui.density === 'touch';
      inner.render(ui);
    },
  };
}
