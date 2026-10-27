/**
 * Tuning for the frost and ward statuses. Kept apart from `StatusEffect.ts`
 * because `Player` reads the speed factors every frame and the fairy casters
 * read the durations, and neither should have to pull in the other's module to
 * get a number.
 */

import type { StatusId } from './StatusEffect';

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

/** Share of each blow a mob under the aegis actually takes. */
export const AEGIS_DAMAGE_SCALE = 0.5;

/** The scale of a status that leaves the damage its carrier takes alone. */
const DAMAGE_UNCHANGED = 1;

/**
 * Every status's multiplier on the damage its carrier takes, from any source.
 * Keyed by every {@link StatusId} so a new status cannot ship without saying
 * whether it changes incoming damage. Read through
 * `statusIncomingDamageScale`, which multiplies the carrier's active entries.
 */
export const STATUS_INCOMING_DAMAGE_SCALE = {
  burn: DAMAGE_UNCHANGED,
  magic_burn: DAMAGE_UNCHANGED,
  poison: DAMAGE_UNCHANGED,
  spit_venom: DAMAGE_UNCHANGED,
  electrified: DAMAGE_UNCHANGED,
  stuck: DAMAGE_UNCHANGED,
  stun: DAMAGE_UNCHANGED,
  drunk: DAMAGE_UNCHANGED,
  catnip_buzz: DAMAGE_UNCHANGED,
  ink: DAMAGE_UNCHANGED,
  blood_vomit: DAMAGE_UNCHANGED,
  double_damage: DOUBLE_DAMAGE_SCALE,
  chilled: DAMAGE_UNCHANGED,
  frozen: DAMAGE_UNCHANGED,
  shield: DAMAGE_UNCHANGED,
  overheal: DAMAGE_UNCHANGED,
  fairy_ward: DAMAGE_UNCHANGED,
  fairy_aegis: AEGIS_DAMAGE_SCALE,
  speed_fizz: DAMAGE_UNCHANGED,
  jugg_juice: DAMAGE_UNCHANGED,
  cooldown_crisp: DAMAGE_UNCHANGED,
  whetstone: DAMAGE_UNCHANGED,
  well_rested: DAMAGE_UNCHANGED,
  hearth_warmed: DAMAGE_UNCHANGED,
  deep_slumber: DAMAGE_UNCHANGED,
  hamburger_fed: DAMAGE_UNCHANGED,
  refreshed: DAMAGE_UNCHANGED,
} as const satisfies Record<StatusId, number>;

/**
 * Whether a status survives a snapshot: `transient` for one that only lasts as
 * long as an on-screen moment, which a restore would otherwise replay for as
 * long as the saved record says. Keyed by every {@link StatusId} so a new
 * status cannot ship without deciding. `snapPlayer` leaves every transient
 * entry out, and a saved snapshot holding one fails validation.
 */
export const STATUS_PERSISTENCE = {
  burn: 'saved',
  magic_burn: 'saved',
  poison: 'saved',
  spit_venom: 'saved',
  electrified: 'saved',
  stuck: 'saved',
  stun: 'saved',
  drunk: 'saved',
  catnip_buzz: 'saved',
  ink: 'saved',
  blood_vomit: 'transient',
  double_damage: 'saved',
  chilled: 'saved',
  frozen: 'saved',
  shield: 'saved',
  overheal: 'saved',
  fairy_ward: 'saved',
  fairy_aegis: 'saved',
  speed_fizz: 'saved',
  jugg_juice: 'saved',
  cooldown_crisp: 'saved',
  whetstone: 'saved',
  well_rested: 'saved',
  hearth_warmed: 'saved',
  deep_slumber: 'saved',
  hamburger_fed: 'saved',
  refreshed: 'saved',
} as const satisfies Record<StatusId, 'saved' | 'transient'>;
