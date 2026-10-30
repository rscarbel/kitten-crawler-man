/**
 * The cues putting gear on and taking it off make. A weapon held in hand is
 * heard coming into and leaving his hand, and claws going on, by their sound
 * family in `weaponSoundCues.ts`; any other piece by what it is made of
 * (`garmentMaterialOf` in `garments/itemLooks.ts`) unless it overrides that.
 * A cursed piece binds on top of its equip cue.
 */

import type { EquipmentChange } from '../core/items/equipment/EquipmentManager';
import type { CrawlerKind } from '../core/skills/SkillManager';
import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import type { GarmentMaterial } from '../sprites/garments/garmentDef';
import { garmentMaterialOf } from '../sprites/garments/itemLooks';
import type { CueSlot } from './cueSlot';
import type { SoundId } from './sounds';
import { clawSoundsOf, handWeaponSoundsOf } from './weaponSoundCues';

/** What a piece of gear is heard as when it goes on: a garment's own material, or a relic waking beside its wearer. */
type EquipMaterial = GarmentMaterial | 'relic';

/** The recordings the equip slots are waiting for. */
type WantedEquipSound = 'relic_equip_wake' | 'buckler_strap_on';

type EquipCueSlot = CueSlot<WantedEquipSound>;

const JEWELRY_TAKES: readonly SoundId[] = ['equip_jewelry_1', 'equip_jewelry_2', 'equip_jewelry_3'];
const METAL_TAKES: readonly SoundId[] = ['equip_metal_armor_1', 'equip_metal_armor_2'];

const EQUIP_CUES: Readonly<Record<EquipMaterial, EquipCueSlot>> = {
  cloth: { takes: ['equip_cloth_1', 'equip_cloth_2', 'equip_cloth_3'] },
  leather: { takes: ['equip_leather_1', 'equip_leather_2', 'equip_leather_3', 'equip_leather_4'] },
  metal: { takes: METAL_TAKES },
  jewelry: { takes: JEWELRY_TAKES },
  relic: { takes: JEWELRY_TAKES, standInFor: 'relic_equip_wake' },
};

/** Pieces heard as something other than their material when they go on. */
const EQUIP_OVERRIDES: Readonly<Partial<Record<ItemId, EquipCueSlot>>> = {
  pot_lid_buckler: { takes: METAL_TAKES, standInFor: 'buckler_strap_on' },
};

/**
 * What putting `id` on is heard as: a relic by what it is, any other piece by
 * `garment`, the material its garment is made of.
 */
function equipMaterialOf(id: ItemId, garment: GarmentMaterial | null): EquipMaterial | null {
  if (ITEM_DEF[id].equipSubSlot === 'Relic') return 'relic';
  return garment;
}

/**
 * The item a crawler put on or took off in `change`, which its equip cue is
 * sounded for; null for a restore, which replaces the whole set silently.
 */
function gearHandledBy(change: EquipmentChange): ItemId | null {
  if (change.reason === 'equip') return change.itemId;
  if (change.reason === 'unequip') return change.removedItemId;
  return null;
}

/**
 * The takes `change` to `crawler`'s gear plays: a hand weapon drawn into his
 * hand or put away, whichever route moved it; claws by their family; a piece
 * with an override of its own by that; any other piece by its material.
 * Silent for a restore and for gear with no material.
 */
export function equipChangeCue(change: EquipmentChange, crawler: CrawlerKind): readonly SoundId[] {
  const handled = gearHandledBy(change);
  if (handled === null) return [];
  const weapon = handWeaponSoundsOf(handled);
  if (weapon !== null) return change.reason === 'equip' ? weapon.draw.takes : weapon.stow.takes;
  const claws = clawSoundsOf(handled);
  if (claws !== null) return claws.equip.takes;
  const override = EQUIP_OVERRIDES[handled];
  if (override !== undefined) return override.takes;
  const material = equipMaterialOf(handled, garmentMaterialOf(handled, crawler));
  return material === null ? [] : EQUIP_CUES[material].takes;
}

const CURSED_BIND_TAKES: readonly SoundId[] = ['cursed_bind'];

/**
 * What `change` binds, on top of its equip cue: a cursed piece put on binds
 * to its wearer; anything else, or a restore, binds nothing.
 */
export function bindCue(change: EquipmentChange): readonly SoundId[] {
  const putOn = change.itemId;
  if (change.reason !== 'equip' || putOn === null) return [];
  const cursed = ITEM_DEF[putOn].traits?.some((trait) => trait.kind === 'cursed') === true;
  return cursed ? CURSED_BIND_TAKES : [];
}
