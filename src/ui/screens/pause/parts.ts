/** Small building blocks the pause pages share: a row of choices, a full-width button, a two-up column split. */

import type { CrawlerKind } from '../../../core/SkillManager';
import { splitH, type Rect } from '../../core/geom';
import type { GlyphId } from '../../theme/glyphs';
import type { ButtonVariant } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { tabs } from '../../widgets/tabs';
import type { SectionLayout } from './section';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** A segmented row of mutually exclusive choices; each segment joins the page's focus walk. */
export function choiceRow<T extends string>(
  layout: SectionLayout,
  opts: {
    readonly id: string;
    readonly choices: readonly Choice<T>[];
    readonly selected: T;
    readonly onPick: (value: T) => void;
  },
): Rect {
  const { ui } = layout;
  const rect = layout.row(buttonHeight(ui));
  const cells = splitH(
    rect,
    opts.choices.map((): 'fill' => 'fill'),
    0,
  );
  const states = tabs(ui, rect, {
    id: opts.id,
    items: opts.choices.map((choice) => ({ id: choice.value, label: choice.label })),
    selected: opts.selected,
    onSelect: (id) => {
      const picked = opts.choices.find((choice) => choice.value === id);
      if (picked !== undefined) opts.onPick(picked.value);
    },
  });
  states.forEach((state, index) => layout.track(cells[index], state));
  return rect;
}

/** A button across the whole column. */
export function wideButton(
  layout: SectionLayout,
  opts: {
    readonly id: string;
    readonly label: string;
    readonly onTap: () => void;
    readonly variant?: ButtonVariant;
    readonly icon?: GlyphId;
    readonly selected?: boolean;
    readonly disabled?: boolean | string;
  },
): Rect {
  const rect = layout.row(buttonHeight(layout.ui));
  layout.track(rect, button(layout.ui, rect, opts), {
    focusable: opts.disabled === undefined || opts.disabled === false,
  });
  return rect;
}

/** Below this column width, pages that show the crawlers side by side stack them instead. */
export const TWO_UP_MIN_WIDTH = 560;

/** Whether a page this wide shows the two crawlers side by side. */
export function fitsTwoUp(width: number): boolean {
  return width >= TWO_UP_MIN_WIDTH;
}

export const CRAWLERS: readonly CrawlerKind[] = ['human', 'cat'];

/**
 * Draws one block per crawler: side by side when the column is wide enough,
 * one after the other when it is not.
 */
export function perCrawler(
  layout: SectionLayout,
  draw: (column: SectionLayout, crawler: CrawlerKind) => void,
): void {
  if (!fitsTwoUp(layout.width)) {
    for (const crawler of CRAWLERS) draw(layout, crawler);
    return;
  }
  const columns = layout.split(CRAWLERS.length, layout.ui.theme.space.lg);
  CRAWLERS.forEach((crawler, index) => draw(columns[index], crawler));
  layout.join(columns);
}
