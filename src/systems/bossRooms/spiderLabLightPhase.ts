/** The phase her first roar begins. */
export const FIRST_DARK_PHASE = 2;
/** Her last phase, whose roar leaves the room at its darkest. */
export const LAST_LIGHT_PHASE = 3;
/**
 * The lighting phases: every bank lit, half blown by her first roar, one more
 * by her second. Built from the named phases, so neither can drift from it.
 */
export type LabLightPhase = 1 | typeof FIRST_DARK_PHASE | typeof LAST_LIGHT_PHASE;
/** The phases that begin with a roar, and so can blow a bank. */
export type BlowingPhase = Exclude<LabLightPhase, 1>;
