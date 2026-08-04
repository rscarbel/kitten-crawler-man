/**
 * Attack-type tags the Ball of Swine puts on the damage it deals.
 *
 * Their own module for the same reason the Rock Golem's are: `DeathCauseSystem`
 * maps them to death-screen copy, and importing them from the creature would drag
 * the whole boss — and everything it imports — into that system's module graph.
 */

/** Being run down by the rolling body. */
export const TRAMPLE_ATTACK_TYPE = 'ballOfSwineTrample';

/** The sewage shockwave a frenzied ball vents when it hits the arena wall. */
export const STENCH_ATTACK_TYPE = 'ballOfSwineStench';
