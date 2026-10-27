/**
 * How a held thing is held: the closed set of grips a crawler's rows are
 * authored for, and what each one accepts.
 *
 * An item names exactly one archetype. The archetype decides which sockets
 * carry it, which handle thicknesses a hand closes round, how long the handle
 * and head may be and where along the haft the hand may sit — the bounds every
 * definition of the archetype is checked against when its module loads —
 * which weights it comes in (each picks a motion set) and
 * where the item rests while it is stowed. A new item of an existing archetype
 * is data; a new archetype is new rows.
 *
 * All lengths are rig units, the units the biped rig is authored in (it is
 * 2.03 units sole to crown).
 */

import type { CrawlerKind } from '../../core/skills/SkillManager';

export const HUMAN_GRIP_ARCHETYPES = [
  'oneHandHaft',
  'twoHandHaft',
  'thrown',
  'slingshot',
  'carriedFlat',
  'smallHeld',
  'offHandHeld',
  'bow',
] as const;
export const CAT_GRIP_ARCHETYPES = ['mouthCarry', 'pawTool'] as const;

export type HumanGripArchetype = (typeof HUMAN_GRIP_ARCHETYPES)[number];
export type CatGripArchetype = (typeof CAT_GRIP_ARCHETYPES)[number];
export type GripArchetype = HumanGripArchetype | CatGripArchetype;

/** The archetypes a weapon item can be held in. */
export const WEAPON_GRIP_ARCHETYPES = [
  'oneHandHaft',
  'twoHandHaft',
  'slingshot',
] as const satisfies readonly GripArchetype[];
export type WeaponGripArchetype = (typeof WEAPON_GRIP_ARCHETYPES)[number];

/** The archetypes the human's off hand carries on its own, beside whatever his main hand holds. */
export const OFF_HAND_GRIP_ARCHETYPES = ['offHandHeld'] as const satisfies readonly GripArchetype[];
export type OffHandGripArchetype = (typeof OFF_HAND_GRIP_ARCHETYPES)[number];

/** Where on the human figure a held or stowed item attaches. */
export type HumanSocket = 'mainHand' | 'offHand' | 'back' | 'hip';
/** Where on the cat figure a held or stowed item attaches. */
export type CatSocket = 'mouth' | 'forePaw' | 'back';
export type HeldSocket = HumanSocket | CatSocket;

/** How thick a handle is, which sets how far a gripping hand's fingers curl. */
export type HandleRadius = 'thin' | 'standard' | 'thick';
export const HANDLE_RADII = [
  'thin',
  'standard',
  'thick',
] as const satisfies readonly HandleRadius[];

/** How heavy an item swings: a light one-hander slashes, a heavy one smashes overhead. */
export type WeightClass = 'light' | 'heavy';
export const WEIGHT_CLASSES = ['light', 'heavy'] as const satisfies readonly WeightClass[];

/** Where an item rests while equipped but not in hand; `none` is put away out of sight. */
export type StowedPlacement = 'hip' | 'back' | 'none';

/**
 * Each radius class's half-thickness, rig units: the Stormcaller grip's wrapped
 * leather, a tool haft, and a club's or a dynamite stick's girth.
 */
export const HANDLE_HALF_WIDTH: Readonly<Record<HandleRadius, number>> = {
  thin: 0.018,
  standard: 0.026,
  thick: 0.038,
};

/** An inclusive range a measurement must fall in. */
export interface ArchetypeRange {
  readonly min: number;
  readonly max: number;
}

/** What one archetype accepts, for a wearer whose sockets are `S`. */
export interface ArchetypeSpec<S extends HeldSocket> {
  readonly wearer: CrawlerKind;
  /**
   * The sockets the item is held in, first the one its grip point sits on.
   * With two, the item's axis runs from the first through the second — the
   * butt hand through the upper hand.
   */
  readonly heldIn: readonly [S] | readonly [S, S];
  readonly radii: readonly HandleRadius[];
  readonly weights: readonly WeightClass[];
  /** Butt to the head's mount, along the haft. */
  readonly handleLength: ArchetypeRange;
  /** The head's run along the haft. */
  readonly headLength: ArchetypeRange;
  /** The head's spread across the haft. */
  readonly headWidth: ArchetypeRange;
  /** Where the hand closes, 0 at the butt to 1 at the head's mount. */
  readonly gripPoint: ArchetypeRange;
  /** Where each weight rests while stowed. */
  readonly stowed: Readonly<Record<WeightClass, StowedPlacement>>;
  /**
   * Carried level rather than turned with the hand: the item's picture is
   * reflected to follow the axis left or right but never rotated, so a crate
   * never turns upside down when the arms swap sides.
   */
  readonly heldLevel: boolean;
}

type ArchetypeTable = Readonly<Record<HumanGripArchetype, ArchetypeSpec<HumanSocket>>> &
  Readonly<Record<CatGripArchetype, ArchetypeSpec<CatSocket>>>;

/**
 * The ranges are the shipped art's own measurements with headroom either side:
 * the arming sword (handle 0.17, blade 0.62, grip 0.5), the hammer (0.32,
 * grip 0.3) and wrench (0.36); tool hafts 0.89–1.05 and the scythe's snath
 * 1.35 with the butt fist at 0.04–0.06; the dynamite stick (0.36, grip 0.42);
 * the slingshot (0.15, fork 0.16 by 0.24); a board (0.86) and crate (0.7 by
 * 0.46); the zippo (0.13) and bottle (0.26); the pot-lid buckler's strap
 * (0.12, grip 0.5) across a lid 0.38 wide; the longbow's riser (0.16, grip
 * 0.5) between limbs 0.8 long, braced 0.17 off the string.
 */
export const GRIP_ARCHETYPES: ArchetypeTable = {
  oneHandHaft: {
    wearer: 'human',
    heldIn: ['mainHand'],
    radii: HANDLE_RADII,
    weights: WEIGHT_CLASSES,
    handleLength: { min: 0.12, max: 0.45 },
    headLength: { min: 0.08, max: 0.9 },
    headWidth: { min: 0.05, max: 0.4 },
    gripPoint: { min: 0.2, max: 0.7 },
    stowed: { light: 'hip', heavy: 'back' },
    heldLevel: false,
  },
  twoHandHaft: {
    wearer: 'human',
    heldIn: ['offHand', 'mainHand'],
    radii: ['standard', 'thick'],
    weights: ['heavy'],
    handleLength: { min: 0.7, max: 1.5 },
    headLength: { min: 0.05, max: 0.6 },
    headWidth: { min: 0.1, max: 0.9 },
    gripPoint: { min: 0, max: 0.2 },
    stowed: { light: 'back', heavy: 'back' },
    heldLevel: false,
  },
  thrown: {
    wearer: 'human',
    heldIn: ['mainHand'],
    radii: ['standard', 'thick'],
    weights: ['light'],
    handleLength: { min: 0.15, max: 0.5 },
    headLength: { min: 0, max: 0.25 },
    headWidth: { min: 0, max: 0.2 },
    gripPoint: { min: 0.25, max: 0.6 },
    stowed: { light: 'none', heavy: 'none' },
    heldLevel: false,
  },
  slingshot: {
    wearer: 'human',
    heldIn: ['mainHand'],
    radii: ['standard'],
    weights: ['light'],
    handleLength: { min: 0.1, max: 0.25 },
    headLength: { min: 0.1, max: 0.3 },
    headWidth: { min: 0.15, max: 0.35 },
    gripPoint: { min: 0.35, max: 0.65 },
    stowed: { light: 'hip', heavy: 'hip' },
    heldLevel: false,
  },
  carriedFlat: {
    wearer: 'human',
    heldIn: ['offHand', 'mainHand'],
    radii: ['thick'],
    weights: WEIGHT_CLASSES,
    handleLength: { min: 0.3, max: 1 },
    headLength: { min: 0, max: 0.1 },
    headWidth: { min: 0.05, max: 0.6 },
    gripPoint: { min: 0, max: 0.25 },
    stowed: { light: 'none', heavy: 'none' },
    heldLevel: true,
  },
  smallHeld: {
    wearer: 'human',
    heldIn: ['mainHand'],
    radii: HANDLE_RADII,
    weights: ['light'],
    handleLength: { min: 0.08, max: 0.3 },
    headLength: { min: 0, max: 0.3 },
    headWidth: { min: 0, max: 0.15 },
    gripPoint: { min: 0.2, max: 0.8 },
    stowed: { light: 'none', heavy: 'none' },
    heldLevel: false,
  },
  /**
   * A shield on the off hand: the fist closed on a short strap across the
   * back of it, the shield's face square to the palm. It rides in every row
   * that leaves that hand free and rests on his back when the hand is wanted
   * for something else; where a weapon he carries already rests there, the
   * runtime moves it to the hip.
   */
  offHandHeld: {
    wearer: 'human',
    heldIn: ['offHand'],
    radii: ['thin', 'standard'],
    weights: ['light'],
    handleLength: { min: 0.08, max: 0.2 },
    headLength: { min: 0.2, max: 0.4 },
    headWidth: { min: 0.2, max: 0.4 },
    gripPoint: { min: 0.3, max: 0.7 },
    stowed: { light: 'back', heavy: 'back' },
    heldLevel: false,
  },
  /**
   * A bow in the off hand, the fist round the riser at the middle of the
   * stave, the other hand left free to nock and draw the string. Its "handle"
   * is the leather-wrapped riser and its "head" is one limb, grip to tip; its
   * width is how far the braced string stands off the riser. Slung across the
   * back while stowed.
   */
  bow: {
    wearer: 'human',
    heldIn: ['offHand'],
    radii: ['standard'],
    weights: ['light'],
    handleLength: { min: 0.08, max: 0.24 },
    headLength: { min: 0.55, max: 1.05 },
    headWidth: { min: 0.1, max: 0.3 },
    gripPoint: { min: 0.4, max: 0.6 },
    stowed: { light: 'back', heavy: 'back' },
    heldLevel: false,
  },
  mouthCarry: {
    wearer: 'cat',
    heldIn: ['mouth'],
    radii: ['thin', 'standard'],
    weights: ['light'],
    handleLength: { min: 0.1, max: 0.5 },
    headLength: { min: 0, max: 0.25 },
    headWidth: { min: 0, max: 0.2 },
    gripPoint: { min: 0.3, max: 0.7 },
    stowed: { light: 'none', heavy: 'none' },
    heldLevel: false,
  },
  pawTool: {
    wearer: 'cat',
    heldIn: ['forePaw'],
    radii: ['standard', 'thick'],
    weights: ['heavy'],
    handleLength: { min: 0.7, max: 1.5 },
    headLength: { min: 0.05, max: 0.6 },
    headWidth: { min: 0.1, max: 0.9 },
    gripPoint: { min: 0, max: 0.2 },
    stowed: { light: 'back', heavy: 'back' },
    heldLevel: false,
  },
};

/** The archetype's spec, widened to either wearer's sockets. */
export function archetypeSpec(archetype: GripArchetype): ArchetypeSpec<HeldSocket> {
  return GRIP_ARCHETYPES[archetype];
}
