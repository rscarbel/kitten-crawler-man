/**
 * The three pages of Belle's senses explainer, opened once per save the first
 * time something only she perceives comes into her reach: switch to her to
 * see it, follow a scent trail from its start to where it leads, and stand
 * still on its strongest patch to sniff.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { byInputMode, keycapLabel, keyLabel, type InputMode } from '../../core/inputMode';
import {
  drawCatSensesFollowPage,
  drawCatSensesSniffPage,
  drawCatSensesSwitchPage,
  prewarmCatSensesArt,
} from '../../icons/explainerArt/catSensesArt';
import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';

/** The pages, worded for the live bindings and the device. */
function catSensesExplainerPages(touch: boolean): ExplainerPageContent[] {
  const mode: InputMode = touch ? 'touch' : 'pointer';
  const cat = crawlerDisplayName('cat');
  const switchKey = keyLabel('switchCharacter');
  const switchHow = byInputMode(mode, {
    touch: `Tap the cat button under the map to switch to ${cat}.`,
    pointer: `Press ${keycapLabel('switchCharacter')} to switch to ${cat}.`,
  });
  return [
    {
      subtitle: `Only ${cat} can sense it`,
      lines: [
        `Scent trails and ward lines show only while you play as ${cat}. When one is near, a ring glows at her feet and her portrait lights up.`,
        switchHow,
      ],
      drawIllustration: (ctx, rect, frame) =>
        drawCatSensesSwitchPage(ctx, rect, frame, mode, switchKey),
    },
    {
      subtitle: 'Follow it from the start',
      lines: [
        `A trail begins where its owner set off. Walk ${cat} onto that end and follow the wisps the way they drift.`,
        'Keep going until it runs out: the end of the trail is where it leads.',
      ],
      drawIllustration: drawCatSensesFollowPage,
    },
    {
      subtitle: 'Stop and sniff',
      lines: [
        `Where the scent is strongest, stand still on it: ${cat} puts her nose down and sniffs.`,
        'Ward lines glow for her too, showing where a ward runs before you step into it.',
      ],
      drawIllustration: drawCatSensesSniffPage,
    },
  ];
}

export const CAT_SENSES_EXPLAINER: ExplainerEntry = {
  get title() {
    return `${crawlerDisplayName('cat')}'s senses`;
  },
  onOpen: prewarmCatSensesArt,
  pages: (touch) => catSensesExplainerPages(touch).map((content) => explainerPage(content)),
};
