/**
 * Which family of rows the human crawler moves and fights in, chosen by what
 * is out in his hand. Bare-handed he punches and kicks; a weapon out picks the rows its grip
 * archetype and weight are authored for, and every item of that archetype and
 * weight plays the same rows — a new sword is a look, never a row.
 *
 * - `oneHandLight`: a light one-hander (a sword) carried low, slashed and
 *   thrust, drawn from and put back at his left hip.
 * - `oneHandHeavy`: a heavy one-hander (a club, a maul-headed thing) carried
 *   on his shoulder, brought down overhead or swept round, drawn from and put
 *   back across his back.
 * - `twoHand`: a long haft held in both fists across his body, swept round,
 *   drawn from and put back across his back.
 *
 * A row belongs to an armed set by naming it in the row table; a row naming
 * none is bare-handed, and is also what an armed set falls back on for the
 * rows it has none of its own for (a stamp, a flinch, an action).
 */

import {
  GRIP_ARCHETYPES,
  type StowedPlacement,
  type WeaponGripArchetype,
  type WeightClass,
} from '../../held/gripArchetypes';

export const ARMED_MOTION_SETS = ['oneHandLight', 'oneHandHeavy', 'twoHand'] as const;
export type ArmedMotionSet = (typeof ARMED_MOTION_SETS)[number];
export type MotionSet = 'unarmed' | ArmedMotionSet;
export const MOTION_SETS = [
  'unarmed',
  ...ARMED_MOTION_SETS,
] as const satisfies readonly MotionSet[];

/**
 * The set each weapon grip plays, by weight. A slingshot has rows of its own
 * for the shot and is otherwise carried in a bare-handed figure's fist.
 */
const MOTION_SET_OF_GRIP: Readonly<
  Record<WeaponGripArchetype, Readonly<Record<WeightClass, MotionSet>>>
> = {
  oneHandHaft: { light: 'oneHandLight', heavy: 'oneHandHeavy' },
  twoHandHaft: { light: 'twoHand', heavy: 'twoHand' },
  slingshot: { light: 'unarmed', heavy: 'unarmed' },
};

/** What a weapon's look names, as far as choosing its rows goes. */
export interface MotionSetSource {
  readonly archetype: WeaponGripArchetype;
  readonly weight: WeightClass;
}

/** The set a weapon held the way `look` says is played in. */
export function motionSetOf(look: MotionSetSource): MotionSet {
  return MOTION_SET_OF_GRIP[look.archetype][look.weight];
}

/**
 * The grip and weight each armed set is authored for: what its rows' hands
 * close round, and where its weapon rests while stowed.
 */
export const ARMED_SET_GRIP: Readonly<Record<ArmedMotionSet, MotionSetSource>> = {
  oneHandLight: { archetype: 'oneHandHaft', weight: 'light' },
  oneHandHeavy: { archetype: 'oneHandHaft', weight: 'heavy' },
  twoHand: { archetype: 'twoHandHaft', weight: 'heavy' },
};

/** Where an armed set's weapon rests while equipped and not in hand, which its draw and stow reach for. */
export function stowedPlacementOfSet(set: ArmedMotionSet): StowedPlacement {
  const grip = ARMED_SET_GRIP[set];
  return GRIP_ARCHETYPES[grip.archetype].stowed[grip.weight];
}

/** A held item being taken out of its stowed place, or put back there. */
export type HolsterMotion = 'draw' | 'stow';
