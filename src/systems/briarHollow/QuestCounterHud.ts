/**
 * A quest counter — "4/10 fence sections", "36/100 grain" — as a card in the
 * HUD's top band, for a step whose progress is a count the player works
 * through with the resource strip's own resources.
 */

import type { Ui } from '../../ui/core/UiRoot';
import { topBandCard, topBandCardPadding, type TopBandEntry } from '../../ui/hud/topBand';
import { measureTextHeight, text } from '../../ui/widgets/text';

const QUEST_COUNTER_MAX_WIDTH = 220;
const QUEST_COUNTER_MAX_LINES = 2;

function counterText(label: string) {
  return { text: label, role: 'value', tabular: true, maxLines: QUEST_COUNTER_MAX_LINES } as const;
}

function contentWidth(ui: Ui, width: number): number {
  return Math.max(0, width - ui.theme.space.md * 2);
}

/** A counter card reading `label`. */
export function questCounterEntry(id: string, label: string): TopBandEntry {
  return {
    id,
    priority: 'encounter',
    maxWidth: QUEST_COUNTER_MAX_WIDTH,
    height: (ui, width) =>
      topBandCardPadding(ui) + measureTextHeight(ui, contentWidth(ui, width), counterText(label)),
    render: (ui, rect) => {
      const inner = topBandCard(ui, rect);
      text(ui, inner, { ...counterText(label), wrap: true, align: 'center' });
    },
  };
}
