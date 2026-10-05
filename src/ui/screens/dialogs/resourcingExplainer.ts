/**
 * The pages of the Resourcing explainer: how to gather, where, and how the
 * skill grows. Built fresh on every open so the key named is the one the
 * player has bound, and a touch screen reads "tap".
 */

import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  drawGatheringScene,
  drawWhereScene,
  drawToolTiersScene,
} from '../../icons/explainerArt/resourcingArt';
import { keybindings } from '../../../core/Keybindings';

/** The explainer's pages, worded for the player's own bindings and device. */
export function resourcingExplainerPages(touch: boolean): ExplainerPageContent[] {
  const press = touch ? 'tap it' : `press ${keybindings.labelFor('attack')}`;
  return [
    {
      subtitle: 'Gathering',
      drawIllustration: drawGatheringScene,
      lines: [
        `Walk up to a tree or a rock and ${press}. Your axe or pickaxe is used automatically.`,
        'Stay put and you keep working: wood and stone will automatically go into your inventory. Moving stops you.',
      ],
    },
    {
      subtitle: 'Where to find it',
      drawIllustration: (ctx, rect) => drawWhereScene(ctx, rect),
      lines: [
        'The lumber yard and the quarry are closest, but any tree or boulder will do.',
        "Trees fall after enough time harvesting and rocks crumble when you've mined all the stone they have.",
      ],
    },
    {
      subtitle: 'Getting better',
      drawIllustration: (ctx, rect) => drawToolTiersScene(ctx, rect),
      lines: [
        'Resourcing levels up with every harvest. Better tools from Oren gather faster, and the finest ones gather more per swing too.',
      ],
    },
  ];
}

export const RESOURCING_EXPLAINER: ExplainerEntry = {
  title: 'How Resourcing works',
  pages: (touch) => resourcingExplainerPages(touch).map((content) => explainerPage(content)),
};
