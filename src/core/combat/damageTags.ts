import type { WeaponFamily, WeaponStats } from '../items/equipment/weapons';

/**
 * What a hit a crawler deals is: the family of the weapon that landed it, and
 * whether it was magic, fire or an explosion. The proficiency skills read these
 * to decide which hits they boost, so a new weapon or spell joins the right
 * skill by declaring its tags, never by being named.
 */
export type DamageTag = WeaponFamily | 'magic' | 'fire' | 'explosion';

export type DamageTags = readonly DamageTag[];

/** A hit that is none of the tagged kinds: a stomp, a bare paw, a gear spark's share of a blow. */
export const UNTAGGED_HIT: DamageTags = [];

/** Every spell hit. */
export const MAGIC_HIT: DamageTags = ['magic'];

/** A hit of flame: a burn's bite, a fire relic's bolt. */
export const FIRE_HIT: DamageTags = ['fire'];

/** Every blast a crawler sets off. */
export const EXPLOSION_HIT: DamageTags = ['explosion'];

/** The tags a hit from `weapon` carries, or none for an empty hand or paw. */
export function weaponHitTags(weapon: WeaponStats | null): DamageTags {
  return weapon === null ? UNTAGGED_HIT : [weapon.family];
}
