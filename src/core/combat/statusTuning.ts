/**
 * Tuning for the frost, venom-slow and ward statuses. Kept apart from `StatusEffect.ts`
 * because `Player` reads the speed factors every frame and the fairy casters
 * read the durations, and neither should have to pull in the other's module to
 * get a number.
 */

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const DOUBLE_DAMAGE_MINUTES = 5;

/** How long the wheel's double-damage curse lasts. */
export const DOUBLE_DAMAGE_FRAMES = DOUBLE_DAMAGE_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;

/** What the double-damage curse multiplies every blow by. */
export const DOUBLE_DAMAGE_SCALE = 2;

/**
 * How long one retch plays on the body, from the frame the blood comes up;
 * the blood-vomit status lasts exactly this long.
 */
export const BLOOD_VOMIT_RETCH_FRAMES = 42;

/** Three seconds of chill at 60 fps. */
export const CHILLED_FRAMES = 180;

/**
 * One second encased. Kept short of any landed fireball's fuse minus the walk
 * out of its blast at the chilled pace, so a crawler frozen standing on a
 * charge can always thaw and step clear before it goes off, even if a second
 * ice bolt re-chills them during the grace window. `FIREBALL_BLAST_RADIUS_TILES`
 * carries the inequality.
 */
export const FROZEN_FRAMES = 60;

/**
 * After a thaw, ice can chill again but not freeze. Without it two casters
 * taking turns could keep a crawler encased indefinitely, which is a loss of
 * control the player never had a chance to answer.
 */
export const FREEZE_GRACE_FRAMES = 120;

/** Walking pace while chilled. */
export const CHILLED_MOVE_SPEED_FACTOR = 0.6;

/**
 * How fast swing timers and ability cooldowns tick while chilled. Slower rather
 * than stopped, so the crawler can still fight back through it.
 */
export const CHILLED_ACTION_SPEED_FACTOR = 0.7;

/** Three seconds of a lizardman's numbing venom at 60 fps. */
export const NUMBED_FRAMES = 180;

/** Walking pace while numbed. Only the legs go slow; swings and casts keep their pace. */
export const NUMBED_MOVE_SPEED_FACTOR = 0.6;

/** Share of each blow a mob under the aegis actually takes. */
export const AEGIS_DAMAGE_SCALE = 0.5;
