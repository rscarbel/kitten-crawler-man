/**
 * The three pages of Briar Hollow's wood-processing explainer: the saw, the
 * rope walk, and paying Fenna to skip both. Built fresh on every open so the
 * key named is the one the player has bound, and a touch screen reads "tap".
 */

import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  drawSawPage,
  drawRopeWalkPage,
  drawFennaPage,
} from '../../icons/explainerArt/processingArt';
import { keybindings } from '../../../core/Keybindings';
import {
  BOARDS_PER_WOOD,
  FENNA_FEE_PER_WOOD,
  ROPE_PER_WOOD,
} from '../../../systems/briarHollow/services/woodProcessing';

/** The explainer's pages, worded for the player's own bindings and device. */
export function processingExplainerPages(touch: boolean): ExplainerPageContent[] {
  const press = touch ? 'tap it' : `press ${keybindings.labelFor('attack')}`;
  return [
    {
      subtitle: 'The Saw',
      drawIllustration: drawSawPage,
      lines: [
        `Walk up to the saw and ${press} to feed it a log — 1 wood becomes ${BOARDS_PER_WOOD} boards. Hold to keep feeding.`,
        'Walking away cancels a cut already under way and spends nothing.',
      ],
    },
    {
      subtitle: 'The Rope Walk',
      drawIllustration: drawRopeWalkPage,
      lines: [
        `The rope walk beside it works the same way: 1 wood becomes ${ROPE_PER_WOOD} rope.`,
        'Working either machine by hand trains your Construction skill.',
      ],
    },
    {
      subtitle: 'Let Fenna do it',
      drawIllustration: drawFennaPage,
      lines: [
        `Rather not stand at a machine yourself? Fenna will run a whole batch for ${FENNA_FEE_PER_WOOD} coin per wood.`,
        "It's a purchase like any other from her — quick, but it earns no Construction XP.",
      ],
    },
  ];
}

export const PROCESSING_EXPLAINER: ExplainerEntry = {
  title: 'How Processing works',
  pages: (touch) => processingExplainerPages(touch).map((content) => explainerPage(content)),
};
