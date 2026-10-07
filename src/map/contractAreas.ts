/**
 * A rectangle of a building that a construction contract can mark for
 * repair without naming a prop: a stretch of floor, a run of wall face, a
 * doorway, or an open side with nothing built across it yet. The layout
 * file that owns the building exports these next to its props, so the
 * geometry moves with the layout.
 *
 * Coordinates are tiles. Skyfowl Town interiors give them in the interior's
 * own grid; Briar Hollow gives them relative to the building rect's
 * north-west corner. `w`/`h` are the rect's size in tiles, at least 1.
 */
export interface ContractArea {
  readonly kind: 'floor' | 'wall' | 'doorway' | 'open_side';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Every area a building offers, keyed by the contract spot id that uses it. */
export type ContractAreaRecord = Readonly<Record<string, ContractArea>>;

/** What every contract prop id starts with, and nothing else's id does. */
export const CONTRACT_PROP_ID_PREFIX = 'contract:';

/**
 * The explicit placed-prop id a contract spot targets: unique across both
 * towns because it carries the site's slug.
 */
export function contractPropId(siteSlug: string, spotId: string): string {
  return `${CONTRACT_PROP_ID_PREFIX}${siteSlug}:${spotId}`;
}
