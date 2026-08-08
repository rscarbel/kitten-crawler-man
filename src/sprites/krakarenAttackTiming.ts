/**
 * The one place the Krakaren Clone's animation timing is written down.
 *
 * Several things have to agree about when tentacles connect and when the
 * ground-slam telegraph hands off between rise/loom/dive: the bake
 * choreographies in `scripts/generate-krakaren-sprite.ts`, the countdown and
 * impact logic in `src/creatures/KrakarenClone.ts` and
 * `src/creatures/KrakarenTentacle.ts`, the bake gates' peak-frame checks in
 * `scripts/generate-krakaren-sprite.gates.ts`, and the runtime row selection
 * in `src/sprites/krakarenSprite.ts` / `src/sprites/krakarenTentacleSprite.ts`.
 * Separate hand-copied constants are a contract that holds until the first
 * retune and then fails silently, with damage landing on a frame where the
 * art has not moved.
 *
 * This module deliberately imports nothing: it is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/** Sprite frames in the body idle rows (`idle`, `idle_side`, `idle_away`). */
export const KRAKAREN_IDLE_FRAMES = 10;

/** Sprite frames in the body melee-swipe rows (`swipe`, `swipe_side`, `swipe_away`). */
export const KRAKAREN_SWIPE_FRAMES = 10;

/**
 * Where in the swipe row the lashing tentacle crosses the target, as a
 * fraction of the row.
 *
 * Expresses the existing melee midpoint-of-swing rule as a row progress so
 * the bake gate and the runtime damage frame read the same moment.
 */
export const KRAKAREN_SWIPE_IMPACT_PROGRESS = 0.5;

/** Sprite frames in the body slam-channel rows (`channel`, `channel_side`, `channel_away`). */
export const KRAKAREN_CHANNEL_FRAMES = 8;

/** Sprite frames in the guard tentacle's ground-emergence row (`emerge`). */
export const GUARD_TENTACLE_EMERGE_FRAMES = 8;

/** Sprite frames in the guard tentacle's idle sway row (`idle`). */
export const GUARD_TENTACLE_IDLE_FRAMES = 8;

/** Sprite frames in the guard tentacle's strike rows (`strike`, `strike_side`, `strike_away`). */
export const GUARD_TENTACLE_STRIKE_FRAMES = 10;

/**
 * Where in the strike row the tentacle connects, as a fraction of the row.
 */
export const TENTACLE_STRIKE_IMPACT_PROGRESS = 0.6;

/** Sprite frames in the guard tentacle's underground-retreat row (`retreat`). */
export const GUARD_TENTACLE_RETREAT_FRAMES = 6;

/** Sprite frames in the slam tentacle's rise row (`rise`). */
export const SLAM_TENTACLE_RISE_FRAMES = 10;

/** Sprite frames in the slam tentacle's risen-and-looming row (`loom`). */
export const SLAM_TENTACLE_LOOM_FRAMES = 8;

/** Sprite frames in the slam tentacle's underground-dive row (`dive`). */
export const SLAM_TENTACLE_DIVE_FRAMES = 6;

/** Sprite frames in the slam tentacle's ground-impact row (`smash`). */
export const SLAM_TENTACLE_SMASH_FRAMES = 12;

/**
 * How the slam's existing telegraph window divides between the tentacle's
 * rise, loom, and dive art.
 *
 * `KrakarenClone`'s `SLAM_SHADOW_FRAMES` (90) telegraph is unchanged by this
 * redraw — these shares repurpose that one timer to drive three rows instead
 * of a shapeless shadow ring, so they must sum to exactly 1.
 */
export const SLAM_RISE_SHARE = 0.4;
export const SLAM_LOOM_SHARE = 0.35;
export const SLAM_DIVE_SHARE = 0.25;

const SLAM_PHASE_SHARE_SUM = SLAM_RISE_SHARE + SLAM_LOOM_SHARE + SLAM_DIVE_SHARE;
const SLAM_PHASE_SHARE_TOLERANCE = 1e-9;
if (Math.abs(SLAM_PHASE_SHARE_SUM - 1) > SLAM_PHASE_SHARE_TOLERANCE) {
  throw new Error(
    `SLAM_RISE_SHARE + SLAM_LOOM_SHARE + SLAM_DIVE_SHARE must equal 1, got ${SLAM_PHASE_SHARE_SUM}`,
  );
}

/**
 * Where in the `smash` row the downward hit visually lands, as a fraction of
 * the row.
 *
 * Positioned early in the row: `executeSlamImpact` deals damage on the first
 * frame of `KrakarenClone`'s existing `SLAM_IMPACT_FRAMES` window, so the
 * visual hit has to be showing by then rather than mid-recoil.
 */
export const SLAM_SMASH_IMPACT_PROGRESS = 0.2;
