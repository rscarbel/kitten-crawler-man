import type { FigureDef } from './figureDef';

/** Which way a body faces as it comes up to a fight: toward the viewer, across, or away. */
export type ApproachView = 'front' | 'side' | 'away';

/** One row of one figure. */
export interface FigureRow {
  readonly def: FigureDef;
  readonly state: string;
}

/** The rows a body walks up to a fight in, then the rows it opens the fight with. */
export interface ApproachRows {
  readonly walk: readonly FigureRow[];
  readonly attack: readonly FigureRow[];
}

/** How a figure's row names carry their view: one mirrored side row, or a suffix per view. */
export type RowViews = 'single' | Readonly<Record<ApproachView, string>>;

export const THREE_VIEW_SUFFIXES = {
  front: '',
  side: '_side',
  away: '_away',
} as const satisfies RowViews;

/** The names of the rows one figure walks up in and opens its fight with. */
interface ApproachRowNames {
  readonly walk: string;
  readonly attacks: readonly string[];
  readonly views: RowViews;
}

/**
 * The rows a kind wearing a look of type `V` walks up to a fight in and opens
 * it with: which figure each look is drawn as, and the row names it plays.
 */
export interface ApproachSpec<V> {
  readonly figure: (variant: V) => FigureDef;
  readonly rows: ApproachRowNames;
}

export const NO_APPROACH_ROWS: ApproachRows = { walk: [], attack: [] };

function rowName(base: string, views: RowViews, view: ApproachView): string {
  return views === 'single' ? base : `${base}${views[view]}`;
}

/**
 * Every row `spec` names for each of `variants`, facing `view`, whether or not
 * each exists in its figure: a caller that warms them skips a missing name,
 * and a gate checks that none is missing.
 */
export function approachRowsFor<V>(
  spec: ApproachSpec<V>,
  variants: readonly V[],
  view: ApproachView,
): ApproachRows {
  const { walk, attacks, views } = spec.rows;
  const figures = variants.map(spec.figure);
  return {
    walk: figures.map((def) => ({ def, state: rowName(walk, views, view) })),
    attack: figures.flatMap((def) =>
      attacks.map((base) => ({ def, state: rowName(base, views, view) })),
    ),
  };
}
