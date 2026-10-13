/**
 * Tuning for the frost and ward statuses. Kept apart from `StatusEffect.ts`
 * because `Player` reads the speed factors every frame and the fairy casters
 * read the durations, and neither should have to pull in the other's module to
 * get a number.
 */

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const BLOOD_VOMIT_MINUTES = 5;

/** How long the wheel's blood vomiting lasts. */
export const BLOOD_VOMIT_FRAMES = BLOOD_VOMIT_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;

const BLOOD_VOMIT_INTERVAL_SECONDS = 10;

/** Frames between one bout of blood vomiting and the next. */
export const BLOOD_VOMIT_INTERVAL_FRAMES = BLOOD_VOMIT_INTERVAL_SECONDS * FRAMES_PER_SECOND;

/** Share of max HP each bout costs. Status damage is unscaled, so this holds on every difficulty. */
export const BLOOD_VOMIT_MAX_HP_SHARE = 0.3;

/** How long a bout's retch plays on the body, from the frame the blood comes up. */
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

/** Share of each blow a mob under the aegis actually takes. */
export const AEGIS_DAMAGE_SCALE = 0.5;
