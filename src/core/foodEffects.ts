/**
 * Numbers behind the two Briar Hollow foods. Definitions only — eating a
 * hamburger or Hollow Stew is wired up where the item's use behaviour lives,
 * not here.
 */

/** Fraction of max HP a Hamburger restores on eating. */
export const HAMBURGER_HEAL_FRACTION = 0.25;
/** Strength granted by `hamburger_fed` while it is active. */
export const HAMBURGER_STR_BONUS = 1;
/** How long `hamburger_fed` lasts; eating again while fed refreshes to this. */
export const HAMBURGER_FED_DURATION_SECONDS = 30;
