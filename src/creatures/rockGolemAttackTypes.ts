/**
 * `DamageSource.attackType` tags the golem's two non-melee attacks carry.
 *
 * They live in their own module so `DeathCauseSystem` can match on them without
 * importing a creature class — the death screen is built at the moment of death
 * and has no business pulling a mob's whole implementation in with it.
 */
export const ROLL_ATTACK_TYPE = 'boulderRoll';
export const ROCK_THROW_ATTACK_TYPE = 'thrownRock';
