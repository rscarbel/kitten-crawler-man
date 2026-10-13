/**
 * The cues gear makes: a held weapon's swing and hit, drawing and stowing it,
 * and putting gear on or taking it off. Each is chosen by the property of the gear
 * that decides how it sounds — a swing by how heavy the item is, a hit by its
 * edge, a draw or stow by what is being pulled out, an equip by what the gear
 * is made of (`garmentMaterialOf` in `garments/itemLooks.ts`). A cue's
 * recording is its list in the tables below; an empty list is a cue with no
 * recording yet, which stays silent.
 */

import type { EquipmentChange } from '../core/EquipmentManager';
import { type ItemId, weaponStatsOf } from '../core/ItemDefs';
import type { GarmentMaterial } from '../sprites/garments/garmentDef';
import type { StrikeKind, WeaponStats } from '../core/weapons';
import type { HolsterMotion } from '../sprites/art/human/motionSets';
import { HELD_VISUALS, stowedPlacementOfHeld } from '../sprites/held/heldVisuals';
import type { SoundId } from './sounds';

/** How heavy a held item swings. */
export type HeldWeight = 'light' | 'heavy' | 'twoHanded';

/** What an item with no held visual swings as: a bare hand's light swing. */
const DEFAULT_HELD_WEIGHT: HeldWeight = 'light';

/**
 * What a draw or stow sounds like: a blade leaving its scabbard, a heavy haft
 * coming off a strap, or a slingshot coming out of a pocket.
 */
export type HolsterKind = 'blade' | 'heavy' | 'sling';

const SWING_CUES: Readonly<Record<HeldWeight, readonly SoundId[]>> = {
  light: ['taranis_swing_1', 'taranis_swing_2', 'taranis_swing_3', 'taranis_swing_4'],
  heavy: ['swing_heavy_1', 'swing_heavy_2', 'swing_heavy_3', 'swing_heavy_4'],
  twoHanded: ['swing_two_handed_1', 'swing_two_handed_2', 'swing_two_handed_3'],
};

const HIT_CUES: Readonly<Record<StrikeKind, readonly SoundId[]>> = {
  blade: ['slash_strike_1', 'slash_strike_2', 'slash_strike_3'],
  blunt: ['blunt_hit_flesh_1', 'blunt_hit_flesh_2', 'blunt_hit_flesh_3'],
};

const HOLSTER_CUES: Readonly<
  Record<HolsterMotion, Readonly<Record<HolsterKind, readonly SoundId[]>>>
> = {
  draw: {
    blade: ['weapon_draw_blade_1', 'weapon_draw_blade_2', 'weapon_draw_blade_3'],
    heavy: ['weapon_draw_heavy'],
    sling: ['slingshot_draw_pocket'],
  },
  stow: {
    blade: ['weapon_stow_blade'],
    heavy: ['weapon_stow_heavy'],
    sling: ['slingshot_stow_pocket'],
  },
};

const EQUIP_CUES: Readonly<Record<GarmentMaterial, readonly SoundId[]>> = {
  cloth: ['equip_cloth_1', 'equip_cloth_2', 'equip_cloth_3'],
  leather: ['equip_leather_1', 'equip_leather_2', 'equip_leather_3', 'equip_leather_4'],
  metal: ['equip_metal_armor_1', 'equip_metal_armor_2'],
  jewelry: ['equip_jewelry_1', 'equip_jewelry_2', 'equip_jewelry_3'],
};

/** The takes a weapon of this weight swings with. */
export function swingCue(weight: HeldWeight): readonly SoundId[] {
  return SWING_CUES[weight];
}

/** The takes a weapon with this edge lands with. */
export function hitCue(strike: StrikeKind): readonly SoundId[] {
  return HIT_CUES[strike];
}

/** The takes drawing or stowing an item of this kind plays. */
export function holsterCue(motion: HolsterMotion, kind: HolsterKind): readonly SoundId[] {
  return HOLSTER_CUES[motion][kind];
}

/** The takes putting on gear of this material plays; silent for gear with no material. */
export function equipCue(material: GarmentMaterial | null): readonly SoundId[] {
  return material === null ? [] : EQUIP_CUES[material];
}

/** How heavy `id` swings, from its held visual: anything two-handed is its own weight. */
export function heldWeightOf(id: ItemId): HeldWeight {
  const visual = weaponStatsOf(id)?.heldVisual;
  if (visual === undefined) return DEFAULT_HELD_WEIGHT;
  const def = HELD_VISUALS[visual];
  return def.archetype === 'twoHandHaft' ? 'twoHanded' : def.weight;
}

/**
 * What drawing or stowing a weapon with these stats sounds like: a slingshot
 * is a sling, anything carried on the back or with a blunt head comes off a
 * strap, and a blade at the hip leaves a scabbard.
 */
export function holsterKindOf(weapon: WeaponStats): HolsterKind {
  if (weapon.delivery === 'sling') return 'sling';
  const restsOnBack = stowedPlacementOfHeld(HELD_VISUALS[weapon.heldVisual]) === 'back';
  return restsOnBack || weapon.strike === 'blunt' ? 'heavy' : 'blade';
}

/**
 * The item a crawler put on or took off in `change`, which its equip cue is
 * sounded for; null for a restore, which replaces the whole set silently.
 */
export function gearHandledBy(change: EquipmentChange): ItemId | null {
  if (change.reason === 'equip') return change.itemId;
  if (change.reason === 'unequip') return change.removedItemId;
  return null;
}
