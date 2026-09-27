/**
 * What "Briar Hollow's Plea" wants the player to do with their hands right
 * now, beyond talking to somebody: the seam between `VillageQuestSystem`,
 * which decides the step, and `VillageQuestGuide`, which picks the exact tree,
 * rock, station or wall segment and draws the highlight, the tool icon, the
 * down-arrow and the caption over it.
 *
 * Rebuilt every frame from the quest's state, like a tracker entry, so it
 * cannot go stale. `null` means no in-world guidance: either nothing is
 * needed or the step is a conversation, which the villager's own marker covers.
 */

import type { TilePoint } from '../../map/town/townPlan';

/** A count toward a target, shown as `${have}/${target}` under the caption. */
export interface GuidanceProgress {
  readonly have: number;
  readonly target: number;
}

export type ProcessingStationId = 'saw' | 'rope_walk';

export interface StationGuidance {
  readonly station: ProcessingStationId;
  readonly progress: GuidanceProgress;
}

/** A rectangle of tiles, top-left inclusive. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type QuestGuidance =
  /**
   * Chop wood in the lumber yard. Until the player reaches the yard, the guide
   * only waypoints the yard itself; once inside, it highlights one grove tree
   * (the centre one first; a neighbour when that one falls; a forced regrow
   * of the centre tree when the grove is bare).
   */
  | { readonly kind: 'chop'; readonly progress: GuidanceProgress }
  /** Mine stone in the quarry: the upper-left rock first, then the nearest standing one. */
  | { readonly kind: 'mine'; readonly progress: GuidanceProgress }
  /** Work the named stations; a station already at its target is left out. */
  | { readonly kind: 'process'; readonly stations: readonly StationGuidance[] }
  /** Build a trebuchet; the zones are suggestions washed in light green, not requirements. */
  | { readonly kind: 'build_trebuchet'; readonly zones: readonly TileRect[] }
  /** Load the trebuchet whose top-left tile is `at`. */
  | { readonly kind: 'load_trebuchet'; readonly at: TilePoint }
  /** Upgrade any fence segment to a wooden wall; the guide marks the one nearest the player. */
  | { readonly kind: 'upgrade_wall' }
  /** Rebuild the broken bell tower. */
  | { readonly kind: 'repair_bell' };
