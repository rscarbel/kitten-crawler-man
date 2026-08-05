/**
 * The one place the facts about the Ball of Swine's sheet are written down: how
 * long each row is, how long each pose plays for, and how big the creature is.
 *
 * Three parties have to agree about it: the choreography in
 * `scripts/generate-ball-of-swine-sprite.ts`, the rows
 * `src/sprites/ballOfSwineSprite.ts` plays, and the phase lengths
 * `src/creatures/BallOfSwine.ts` runs the fight on. The row lengths used to be
 * bare literals at the three draw call sites, so the first frame-count change
 * would have played half a row and repeated the rest.
 *
 * This module deliberately imports nothing: it is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/**
 * Sprite frames in the rolling row.
 *
 * The row is sampled by the ball's *rolled distance*, not by time, so this is a
 * spatial resolution rather than a frame rate: twelve frames is 30° of ball per
 * frame. At the fastest roll the ball turns about 3° a game frame, so every
 * sprite frame is held for roughly ten of them — well clear of the aliasing
 * floor, where an oscillation sampled below twice its own frequency reads as a
 * freeze or a strobe.
 */
export const BOS_ROLL_FRAMES = 12;

/** Sprite frames in the wallowing row — the vulnerable heave, played on a loop. */
export const BOS_WALLOW_FRAMES = 8;

/**
 * Sprite frames in the spin-up row.
 *
 * Played across `BOS_SPINUP_GAME_FRAMES`, which is paced by how long the player
 * needs to read "it is getting up" and clear out, not by the row's length.
 */
export const BOS_SPINUP_FRAMES = 6;

/** Sprite frames in the wall-slam row. */
export const BOS_SLAM_FRAMES = 4;

/** Sprite frames in the death-burst row. */
export const BOS_BURST_FRAMES = 8;

/**
 * Game frames the spin-up telegraph occupies.
 *
 * Above this codebase's 21-frame floor on every locked telegraph
 * (`MIN_LOCKED_TELEGRAPH_FRAMES` in `scripts/verify-difficulty.ts`), with room
 * to spare: this one ends with a boss the size of a room accelerating at you,
 * so the read has to be finishable from anywhere in the arena rather than
 * merely possible.
 */
export const BOS_SPINUP_GAME_FRAMES = 48;

/** Game frames the wall-slam animation is held for after an impact. */
export const BOS_SLAM_GAME_FRAMES = 22;

/** Game frames the death burst plays for before the Tusklings are released. */
export const BOS_BURST_GAME_FRAMES = 70;

/**
 * The ball's radius in tiles.
 *
 * Shared with `scripts/ballOfSwineArt.ts`, which paints to it, because it is a
 * gameplay number as much as an art one: the fight's contact radius, the distance
 * it caroms off the arena wall at, and how much of a 13-tile arena it occupies are
 * all priced against it. Two copies of this would put the picture and the hitbox
 * quietly out of register.
 */
export const BOS_BODY_RADIUS_TILES = 1.4;
