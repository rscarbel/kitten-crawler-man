/**
 * The one-page hint that both crawlers can harvest at the same time: the
 * crawler you switch away from keeps working while you set the other to a
 * second node.
 */

import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  drawDualHarvestScene,
  prewarmDualHarvestArt,
} from '../../icons/explainerArt/dualHarvestArt';
import { byInputMode, keycapLabel, keyLabel, type InputMode } from '../../core/inputMode';

function dualHarvestLines(mode: InputMode): readonly string[] {
  const switchPhrase = byInputMode(mode, {
    touch: 'tap the switch button',
    pointer: `press ${keycapLabel('switchCharacter')}`,
  });
  const harvestPhrase = byInputMode(mode, { touch: 'tap', pointer: `press ${keyLabel('attack')}` });
  return [
    `Start chopping or mining, then ${switchPhrase} to take control of your companion. Whoever you left keeps working on their own.`,
    `Walk your companion to a tree or rock nearby and ${harvestPhrase}. Now you are both gathering at once.`,
    'Stay close together: wander too far and your companion stops working to follow you.',
  ];
}

/** The page, worded for the live bindings and the device. */
export function dualHarvestExplainerPage(touch: boolean): ExplainerPageContent {
  const mode: InputMode = touch ? 'touch' : 'pointer';
  const switchKey = keyLabel('switchCharacter');
  return {
    subtitle: 'Two crawlers, twice the haul',
    lines: dualHarvestLines(mode),
    drawIllustration: (ctx, rect, frame) => drawDualHarvestScene(ctx, rect, frame, mode, switchKey),
  };
}

export const DUAL_HARVEST_EXPLAINER: ExplainerEntry = {
  title: 'Harvest with both crawlers',
  onOpen: prewarmDualHarvestArt,
  pages: (touch) => [explainerPage(dualHarvestExplainerPage(touch))],
};
