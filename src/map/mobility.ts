/**
 * Who can stand where. Every body that moves declares the class it moves as,
 * and every tile type and placed prop declares the classes that may stand on
 * it: a walker keeps to the floor, a climber also reaches ledges and squeezes
 * through gaps. A class is a fact about the creature, never about the part it
 * plays — a cat climbs whether she is the crawler, a companion or a stray.
 */

export const MOBILITY_CLASSES = ['walker', 'climber'] as const;

export type MobilityClass = (typeof MOBILITY_CLASSES)[number];

/** The classes that may stand on a tile or a placed prop. */
export type PassableBy = ReadonlySet<MobilityClass>;

export const PASSABLE_BY_EVERYONE: PassableBy = new Set<MobilityClass>(MOBILITY_CLASSES);
export const PASSABLE_BY_NOBODY: PassableBy = new Set<MobilityClass>();
export const PASSABLE_BY_CLIMBERS: PassableBy = new Set<MobilityClass>(['climber']);

/**
 * What a climber stands on at a tile: the floor, a ledge above it, or a gap
 * she flattens to fit. A step between two footings is a traversal, not a walk.
 */
export type Footing = 'floor' | 'ledge' | 'gap';

/** How far a ledge's top stands above the floor, in tiles: what a climber on one is drawn lifted by. */
export const LEDGE_RISE_TILES = 0.42;

/** The move a climber makes stepping from one footing to another; null for a plain step. */
export type FootingTransition = 'hop_up' | 'hop_down' | 'squeeze';

export function footingTransition(from: Footing, to: Footing): FootingTransition | null {
  if (from === to) return null;
  if (to === 'gap' || from === 'gap') return 'squeeze';
  return to === 'ledge' ? 'hop_up' : 'hop_down';
}
