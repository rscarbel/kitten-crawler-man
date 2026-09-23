/**
 * Helpers for a prop's `PropReach`, kept out of `props.ts` so a prop module
 * importing them does not import the registry that imports it.
 */

import type { PropReach } from '../props';
import type { Pt } from '../../carlArt';

/** The two corners of the square of half-side `radius` round `centre`. */
export function squareAround(centre: Pt, radius: number): readonly Pt[] {
  return [
    { x: centre.x - radius, y: centre.y - radius },
    { x: centre.x + radius, y: centre.y + radius },
  ];
}

/**
 * The reach of a prop drawn about its grip, at `radius` at its authored size:
 * the farthest any of its ink lies from the grip, in any direction.
 */
export function reachAround(radius: number): PropReach {
  return (grip, prop) => squareAround(grip.centre, radius * (prop.scale ?? 1));
}
