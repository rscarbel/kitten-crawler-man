/**
 * The one place the Tuskling's animation timing is written down.
 *
 * Four things have to agree about when its tusks connect: the pose choreography
 * in `scripts/generate-tuskling-sprite.ts`, the impact countdown in
 * `src/creatures/Tuskling.ts`, the frame the bake gate asserts is the peak of
 * the hook, and the row length `src/sprites/tusklingSprite.ts` plays. Separate
 * hand-copied constants are a contract that holds until the first retune and
 * then fails silently, with the damage landing on a frame where the head has
 * not moved.
 *
 * This module deliberately imports nothing: it is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/** Sprite frames in the idle rows. */
export const TUSKLING_IDLE_FRAMES = 8;

/**
 * Sprite frames in the walk rows. Twice the other cycles: the walk plays most
 * and travels furthest, so it is the one where eight steps read as a stutter.
 */
export const TUSKLING_WALK_FRAMES = 16;

/** Sprite frames in the tusk-hook attack rows. */
export const TUSKLING_HOOK_FRAMES = 10;
/**
 * Where in the hook the tusks cross the target, as a fraction of the row.
 *
 * The head cocks away, drives up and across, and recovers; the damage belongs
 * on the drive. Landed on the cock it reads as a hit that happened before the
 * head moved, and landed on the recovery it reads as a reaction to it.
 */
export const TUSKLING_HOOK_IMPACT_PROGRESS = 0.5;

/**
 * Sprite frames in the charge-windup rows: head down, hoof pawing the ground.
 *
 * Longer than the other one-shots because its last third is spent easing into
 * the sprint's opening pose. Packed into eight frames the telegraph and the
 * launch share the row and the wind-up stops being a distinct picture from the
 * charge — which is the only thing it is for.
 */
export const TUSKLING_SNORT_FRAMES = 12;

/** Sprite frames in the head-down charging-run rows. */
export const TUSKLING_CHARGE_FRAMES = 8;

/** Game frames each sprite frame of a one-shot row is held for. */
export const TUSKLING_FRAME_HOLD = 3;

/**
 * Game frames each sprite frame of the charging run is held for.
 *
 * Shorter than a one-shot's hold because the charge covers ground several times
 * faster than the walk does. Driving this row off the shared walk phase instead
 * undersamples it — frames are skipped, the legs jump between non-adjacent
 * poses, and the creature reads as vibrating rather than as sprinting.
 */
export const TUSKLING_CHARGE_FRAME_HOLD = 2;

/** How many game frames a one-shot row of `spriteFrames` frames occupies. */
export function tusklingActionFrames(spriteFrames: number): number {
  return spriteFrames * TUSKLING_FRAME_HOLD;
}

/** The game frame within a one-shot on which its impact lands. */
export function tusklingImpactFrame(spriteFrames: number, impactProgress: number): number {
  return Math.max(1, Math.round(tusklingActionFrames(spriteFrames) * impactProgress));
}

/**
 * The *sprite* frame showing at the moment of impact.
 *
 * Exported rather than re-derived, because there is more than one plausible
 * formula for it — `floor(p·F)` and `round(p·(F−1))` agree at `p = 0.5` and
 * part company everywhere else. The bake gate asserts the pose peaks on this
 * frame and the runtime draws this frame; if they each did their own arithmetic
 * the two would silently describe different moments the first time the impact
 * was retuned, which is the failure this module exists to prevent.
 */
export function tusklingImpactSpriteFrame(spriteFrames: number, impactProgress: number): number {
  return Math.max(0, Math.min(spriteFrames - 1, Math.floor(impactProgress * spriteFrames)));
}

/**
 * Game frames the charge wind-up occupies before the sprint begins.
 *
 * Longer than `TUSKLING_SNORT_FRAMES * TUSKLING_FRAME_HOLD`: the telegraph is
 * paced by how long the player needs to react, not by the row's length, so the
 * row is stretched across it rather than held at the standard rate.
 */
export const TUSKLING_WINDUP_GAME_FRAMES = 35;
