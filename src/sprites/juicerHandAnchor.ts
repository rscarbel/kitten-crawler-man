/**
 * The Juicer's held dumbbell, as a geometry contract.
 *
 * The dumbbell is not baked into any row — `heldDumbbell` is sometimes false
 * during pursuit, and one sheet cannot carry a conditional prop — so the
 * runtime anchors a separate overlay at the gripping hand instead. Two things
 * then have to agree: where the hand is while carrying, and where it travels
 * through the throw. This module is where both live.
 *
 * It imports nothing, because two very different things need it:
 * `juicerSprite.ts` positions the overlay from it, and
 * `scripts/generate-juicer-sprite.gates.ts` checks it against the rig on
 * every bake (`gateHandAnchors`, modelled on the Troglodyte's
 * `gateMouthAnchors`). A generator cannot import the sprite module — that
 * would drag the whole `SpriteLoader` and its browser globals into a Node
 * process — so without a module like this one the numbers get copied, and a
 * redraw then silently moves the arm while the dumbbell keeps floating where
 * the hand used to be.
 *
 * The values below are starting points; the gate recomputes them from the
 * baked rig on every run and fails the bake when the two drift apart.
 */

/** Which of the sheet's three viewpoints a facing vector selects. */
export type JuicerHandView = 'front' | 'side' | 'away';

export interface TileFraction {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the gripping hand sits while carrying the dumbbell — `idle` and
 * `walk` rows only. `sprint` is always empty-handed (he sprints to a
 * dumbbell; the carry starts after pickup), so it has no anchor here.
 */
export const JUICER_CARRY_HAND_ANCHORS: Record<JuicerHandView, TileFraction> = {
  front: { x: 0.978, y: 0.118 },
  side: { x: 0.756, y: 0.175 },
  away: { x: 0.978, y: 0.118 },
};

/**
 * Where the throwing hand is on **each frame** of the throw, per view.
 *
 * One anchor per view is not enough: the arm is driven from a hip coil
 * through an overhead heave to release, sweeping most of a tile edge-on, so a
 * single baked point is right on exactly one frame and wrong on all the
 * others. Indexed by the throw row's own sprite frame.
 */
export const JUICER_THROW_HAND_ANCHORS: Record<JuicerHandView, ReadonlyArray<TileFraction>> = {
  front: [
    { x: 0.859, y: 0.181 },
    { x: 0.852, y: 0.102 },
    { x: 0.845, y: 0.022 },
    { x: 0.832, y: -0.288 },
    { x: 0.808, y: -1.102 },
    { x: 0.86, y: -1.246 },
    { x: 0.86, y: -1.098 },
    { x: 0.859, y: -0.95 },
    { x: 0.927, y: -0.155 },
    { x: 0.94, y: 0.107 },
  ],
  side: [
    { x: 0.66, y: 0.181 },
    { x: 0.49, y: 0.059 },
    { x: 0.319, y: -0.064 },
    { x: 0.133, y: -0.427 },
    { x: 0.552, y: -1.215 },
    { x: 1.157, y: -1.222 },
    { x: 1.091, y: -0.992 },
    { x: 1.025, y: -0.761 },
    { x: 0.767, y: -0.087 },
    { x: 0.66, y: 0.181 },
  ],
  away: [
    { x: 0.859, y: 0.181 },
    { x: 0.852, y: 0.102 },
    { x: 0.845, y: 0.022 },
    { x: 0.832, y: -0.288 },
    { x: 0.808, y: -1.102 },
    { x: 0.86, y: -1.246 },
    { x: 0.86, y: -1.098 },
    { x: 0.859, y: -0.95 },
    { x: 0.927, y: -0.155 },
    { x: 0.94, y: 0.107 },
  ],
};

/** The centre of a tile, which every anchor here is measured from. */
export const TILE_CENTRE_FRACTION = 0.5;
