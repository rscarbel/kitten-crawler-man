/**
 * The Hollow Bell's numbers: what the village's assault is fought to protect.
 *
 * The bell is the villagers' own, not a player construction, so none of the
 * Construction perks touch it — its health is not doubled at level 15, it
 * takes no spikes, and it can never be dismantled. It can be patched up with
 * boards mid-fight, which gives a crawler something to do at the square when
 * the walls have gone.
 */

import type { ResourceCost } from '../../core/partyResources';

/** The bell's health. The assault is lost the moment it reaches zero. */
export const HOLLOW_BELL_MAX_HP = 600;

/**
 * The most one blow may take off the bell, as a share of its health. A Grave
 * Bull's charge is built to batter walls down, and at its full weight two of
 * them inside the ring would crack the bell in the time it takes to run
 * back to the square; capped, the bell falls to a crowd, never to a couple
 * of charges.
 */
export const HOLLOW_BELL_MAX_BLOW_SHARE = 0.04;

/**
 * The share of a blow the bell takes. A siege mob's blow is sized to chew
 * through timber and stone; the bell is the thing the fight is about, and at
 * full weight a handful of the dead inside the ring would crack it before
 * anyone could run back to the square. Damped, the crowd at the bell is a
 * race the defenders can see coming and still win.
 */
export const HOLLOW_BELL_DAMAGE_TAKEN_SCALE = 0.4;

/** One chunk of repair — a fifth of the bell — costs two boards. */
export const HOLLOW_BELL_REPAIR_CHUNK_COST: ResourceCost = { wood_board: 2 };

/** Seconds a bell repair takes at Construction level 1, however many chunks it restores. */
export const HOLLOW_BELL_REPAIR_SECONDS = 2;

/** What the menus call it. */
export const HOLLOW_BELL_LABEL = 'The Hollow Bell';

/** The bell tower is two tiles square; the bell is its whole footprint. */
export const HOLLOW_BELL_FOOTPRINT_TILES = 2;
