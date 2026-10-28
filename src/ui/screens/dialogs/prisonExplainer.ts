/**
 * The Goblin High Security Prison's three-page explainer, shown on the first
 * visit as the room comes into view: the lights see you, guards hear a fight,
 * and a capture means a cell whose door breaks to any hit. The prison's key
 * system owns whether it is open; the last page's button and Escape (or ✕)
 * both put it away and mark it read.
 */

import { byInputMode } from '../../core/inputMode';
import type { Surface } from '../../core/UiRoot';
import {
  drawPrisonCellPage,
  drawPrisonLightsPage,
  drawPrisonNoisePage,
} from '../../icons/explainerArt/prisonArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { explainerPage } from './explainerPages';
import { buildingDisplayName } from '../../../map/buildingIds';

/** What the explainer reads from, and drives on, the prison's key system. */
export interface PrisonExplainerModel {
  readonly isPrisonExplainerOpen: boolean;
  /** "Start sneaking" on the last page. */
  finishPrisonExplainer(): void;
  /** Escape or ✕. */
  dismissPrisonExplainer(): void;
}

const TITLE = buildingDisplayName('level2_goblin_prison');
const DONE_LABEL = 'Start sneaking';

function pages(touch: boolean): readonly PagedOverlayPage[] {
  const mode = touch ? 'touch' : 'pointer';
  return [
    explainerPage({
      subtitle: 'Stay out of the lights',
      lines: [
        "Guards' flashlights and the tower spotlights both see you. Your partner follows in your footsteps, and they can see your partner too.",
        'A guard who spots you shows a ? while it makes sure. Get out of the light before it turns into a !',
      ],
      drawIllustration: drawPrisonLightsPage,
    }),
    explainerPage({
      subtitle: 'Guards hear fighting',
      lines: [
        "You can't hurt the guards. Every hit and every blast makes noise, and guards nearby come over to look.",
        'Hitting a guard that can see you gets you caught on the spot.',
      ],
      drawIllustration: drawPrisonNoisePage,
    }),
    explainerPage({
      subtitle: 'Caught? Break out',
      lines: [
        "If you're caught, you wake up in a holding cell by the entrance. Anything you carry stays with you.",
        byInputMode(mode, {
          touch: 'The cell doors are flimsy: tap attack to break one.',
          pointer: 'The cell doors are flimsy: any hit breaks one.',
        }),
      ],
      drawIllustration: drawPrisonCellPage,
    }),
  ];
}

const POINTER_PAGES = pages(false);
const TOUCH_PAGES = pages(true);

/** Modal and halting; the arrows turn its pages, and Space or Enter presses its button. */
export function prisonExplainerSurface(
  model: PrisonExplainerModel,
  id = 'prison-explainer',
): Surface {
  let touch = false;
  const inner = pagedOverlaySurface({
    id,
    title: TITLE,
    get pages(): readonly PagedOverlayPage[] {
      return touch ? TOUCH_PAGES : POINTER_PAGES;
    },
    doneLabel: DONE_LABEL,
    onDone: () => model.finishPrisonExplainer(),
    onClose: () => model.dismissPrisonExplainer(),
    isOpen: () => model.isPrisonExplainerOpen,
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
