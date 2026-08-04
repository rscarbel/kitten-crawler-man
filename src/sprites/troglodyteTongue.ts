/**
 * The troglodyte's tongue, as a geometry contract.
 *
 * The tongue is not baked into the creature's sheet — it reaches three tiles,
 * twenty times the creature's own width — so the runtime anchors a separate
 * rotated overlay at the mouth. Three things then have to agree: where the
 * mouth is, how far the art reaches from it, and how far the mob can actually
 * hurt someone. This module is where all three live.
 *
 * It imports nothing, because two very different things need it:
 * `troglodyteSprite.ts` positions the overlay from it, `Troglodyte.ts` fires
 * its hit test from it, and `scripts/generate-troglodyte-sprite.gates.ts`
 * checks it against the rig on every bake. A generator cannot import the sprite
 * module — that would drag the whole `SpriteLoader` and its browser globals
 * into a Node process — so without a module like this one the numbers get
 * copied, and a redraw then silently moves the head while the tongue keeps
 * coming out of where the head used to be.
 *
 * The anchors are printed by the generator on every bake; the `G13` gate fails
 * the bake when they drift, and `G16` when the reach does.
 */

/** Which of the sheet's three viewpoints a facing vector selects. */
export type TroglodyteView = 'front' | 'side' | 'away';

export interface TileFraction {
  readonly x: number;
  readonly y: number;
}

/**
 * Taken from the pose the tongue actually fires on rather than from the resting
 * pose: the head thrusts most of a third of a tile forward over the lash, and
 * an anchor measured standing still puts the tongue's root in the creature's
 * chest on the one frame anybody is looking at it.
 *
 * Used only as a fallback when the lash frame is not known — see
 * {@link TROGLODYTE_LASH_MOUTH_ANCHORS}, which is what actually positions the
 * tongue.
 */
export const TROGLODYTE_MOUTH_ANCHORS: Record<TroglodyteView, TileFraction> = {
  front: { x: 0.741, y: 0.1005 },
  side: { x: 0.9821, y: 0.0719 },
  away: { x: 0.2695, y: 0.0939 },
};

/**
 * Where the mouth is on **each frame** of the lash, per view.
 *
 * One anchor per view is not enough, and the reason is the strike itself: the
 * head is thrown forward through it — most of a third of a tile edge-on — so a
 * single baked point is right on exactly one frame and wrong on all the others.
 * Edge-on that error runs along the creature's own facing, which is the one
 * direction that makes the tongue read as floating in front of its jaw rather
 * than leaving it.
 *
 * Indexed by the *body's* lash frame, not the tongue's own extension frame: the
 * two advance on different clocks, and it is the body that says where the head
 * is.
 */
export const TROGLODYTE_LASH_MOUTH_ANCHORS: Record<TroglodyteView, ReadonlyArray<TileFraction>> = {
  front: [
    { x: 0.6866, y: 0.0999 },
    { x: 0.6917, y: 0.1 },
    { x: 0.7257, y: 0.1004 },
    { x: 0.7407, y: 0.1005 },
    { x: 0.7373, y: 0.0982 },
    { x: 0.7185, y: 0.0859 },
    { x: 0.706, y: 0.0768 },
    { x: 0.7062, y: 0.0755 },
  ],
  side: [
    { x: 0.7686, y: 0.0811 },
    { x: 0.7972, y: 0.078 },
    { x: 0.9199, y: 0.0705 },
    { x: 0.979, y: 0.0715 },
    { x: 0.9726, y: 0.0699 },
    { x: 0.92, y: 0.0593 },
    { x: 0.8711, y: 0.0509 },
    { x: 0.8511, y: 0.0488 },
  ],
  away: [
    { x: 0.3197, y: 0.096 },
    { x: 0.315, y: 0.0958 },
    { x: 0.2836, y: 0.0945 },
    { x: 0.2698, y: 0.0939 },
    { x: 0.2729, y: 0.0917 },
    { x: 0.2903, y: 0.0804 },
    { x: 0.3018, y: 0.0718 },
    { x: 0.3016, y: 0.0706 },
  ],
};

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
 * How far the baked tongue art reaches from its own root, in tiles.
 *
 * Kept in step with `TONGUE_REACH_TILES` in `scripts/trogTongue.ts` by the
 * `G16` bake gate. The runtime does *not* draw the overlay at this length: the
 * mouth sits a different distance from the creature's tile in every view — most
 * of half a tile forward in profile against a third of a tile back head-on — so
 * a single drawn length puts the tip nearly a tile past the damage range in one
 * view and short of it in another. `troglodyteSprite.ts` scales the overlay per
 * view so the tip always lands on {@link TROGLODYTE_TONGUE_HIT_REACH_TILES}.
 */
export const TROGLODYTE_TONGUE_ART_REACH_TILES = 3.2;

/** The centre of a tile, which every reach here is measured from. */
export const TILE_CENTRE_FRACTION = 0.5;
