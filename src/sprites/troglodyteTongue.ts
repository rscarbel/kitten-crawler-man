/**
 * The troglodyte's tongue, as a geometry contract.
 *
 * The tongue is not painted into the creature's own cells — it reaches three
 * tiles, twenty times the creature's width — so the runtime anchors a separate
 * rotated overlay at the mouth. Three things then have to agree: where the
 * mouth is, how far the art reaches from it, and how far the mob can actually
 * hurt someone. This module is where all three meet.
 *
 * The anchors and the art's reach are *read from the painter* rather than
 * copied from it. They used to be frozen tables, because the runtime could not
 * import a module that lived under `scripts/` and a bake gate compared the two
 * copies on every run; now both sides live under `src/`, so the head cannot
 * move without the tongue moving with it.
 */

import {
  TONGUE_ART_REACH_TILES,
  lashMouthAnchorsInTile,
  mouthAnchorsInTile,
} from './art/troglodyteFigure';
import type { Pt, TrogView } from './art/trogArt';

/** Which of the figure's three viewpoints a facing vector selects. */
export type TroglodyteView = 'front' | 'side' | 'away';

export interface TileFraction {
  readonly x: number;
  readonly y: number;
}

/** The painter names the away view `back`; the runtime names it `away`. */
const PAINTED_VIEW_OF: Record<TroglodyteView, TrogView> = {
  front: 'front',
  side: 'side',
  away: 'back',
};

function byRuntimeView<T>(of: (view: TrogView) => T): Record<TroglodyteView, T> {
  return {
    front: of(PAINTED_VIEW_OF.front),
    side: of(PAINTED_VIEW_OF.side),
    away: of(PAINTED_VIEW_OF.away),
  };
}

function tileFraction(point: Pt): TileFraction {
  return { x: point.x, y: point.y };
}

/**
 * Where the tongue leaves the mouth, per view, as a fraction of a tile measured
 * from the top-left of the creature's own tile.
 *
 * Taken from the pose the tongue actually fires on rather than from the resting
 * pose: the head thrusts nearly a third of a tile over the lash, and an anchor
 * measured standing still puts the tongue's root in the creature's chest.
 *
 * Used only as a fallback when the lash frame is not known — see
 * {@link TROGLODYTE_LASH_MOUTH_ANCHORS}, which is what actually positions the
 * tongue.
 */
export const TROGLODYTE_MOUTH_ANCHORS: Record<TroglodyteView, TileFraction> = byRuntimeView(
  (view) => tileFraction(mouthAnchorsInTile()[view]),
);

/**
 * Where the mouth is on **each frame** of the lash, per view.
 *
 * One anchor per view is not enough, and the reason is the strike itself: the
 * head is thrown forward through it — most of a third of a tile edge-on — so a
 * single point is right on exactly one frame and wrong on all the others.
 * Edge-on that error runs along the creature's own facing, which is the one
 * direction that makes the tongue read as floating in front of its jaw rather
 * than leaving it.
 *
 * Indexed by the *body's* lash frame, not the tongue's own extension frame: the
 * two advance on different clocks, and it is the body that says where the head
 * is.
 */
export const TROGLODYTE_LASH_MOUTH_ANCHORS: Record<
  TroglodyteView,
  ReadonlyArray<TileFraction>
> = byRuntimeView((view) => lashMouthAnchorsInTile()[view].map(tileFraction));

/** How far the mob will strike, in tiles, centre to centre. */
export const TROGLODYTE_TONGUE_RANGE_TILES = 3;

/**
 * Extra range the hit test allows past that, so a target stepping out on the
 * frame the tongue lands still takes it.
 */
export const TROGLODYTE_TONGUE_OVERREACH = 1.1;

/** The furthest the strike can connect, which is what the art has to match. */
export const TROGLODYTE_TONGUE_HIT_REACH_TILES =
  TROGLODYTE_TONGUE_RANGE_TILES * TROGLODYTE_TONGUE_OVERREACH;

/**
 * How far the painted tongue reaches from its own root, in tiles.
 *
 * The runtime does *not* draw the overlay at this length: the mouth sits a
 * different distance from the creature's tile in every view — most of half a
 * tile forward in profile against a third of a tile back head-on — so a single
 * drawn length puts the tip nearly a tile past the damage range in one view and
 * short of it in another. `troglodyteSprite.ts` scales the overlay per view so
 * the tip always lands on {@link TROGLODYTE_TONGUE_HIT_REACH_TILES}.
 */
export const TROGLODYTE_TONGUE_ART_REACH_TILES = TONGUE_ART_REACH_TILES;

/** The centre of a tile, which every reach here is measured from. */
export const TILE_CENTRE_FRACTION = 0.5;
