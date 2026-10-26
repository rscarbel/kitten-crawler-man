/**
 * How far a crawler is through each gear set: which pieces she wears, which
 * bonuses are on, and whether the set is complete. A set's pieces are read off
 * the item definitions (`set` on each piece), so the set list and the items can
 * never disagree.
 */

import { ITEM_DEF, isItemId, type ItemId } from '../core/items/defs/ItemDefs';
import { rarityRank, type Rarity } from '../core/items/defs/rarity';
import type { Player } from '../Player';
import { GEAR_SETS, type GearSetBonus, type GearSetId } from './sets';

/** Every piece of `set`, in item-definition order, which is the order its pips list them. */
export function setPieceIds(set: GearSetId): ItemId[] {
  return Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => ITEM_DEF[id].set === set);
}

/** The ids `wearer` has on, as a list. */
type Equipped = Iterable<ItemId>;

/** The bonuses of `set` switched on at `worn` pieces. */
export function activeSetBonuses(set: GearSetId, worn: number): GearSetBonus[] {
  return GEAR_SETS[set].bonuses.filter((bonus) => worn >= bonus.pieces);
}

/** The piece count at which `set`'s last bonus switches on, which is what completes it. */
export function setCompletionPieces(set: GearSetId): number {
  return GEAR_SETS[set].bonuses.reduce((most, bonus) => Math.max(most, bonus.pieces), 0);
}

/** Every set with any piece among `equipped`, with how many of its pieces are on. */
export function wornSets(equipped: Equipped): Map<GearSetId, number> {
  const counts = new Map<GearSetId, number>();
  for (const id of equipped) {
    const set = ITEM_DEF[id].set;
    if (set !== undefined) counts.set(set, (counts.get(set) ?? 0) + 1);
  }
  return counts;
}

/** One pip of a set's progress row in the detail pane. */
export interface SetPip {
  readonly id: ItemId;
  readonly worn: boolean;
}

export interface SetProgress {
  readonly set: GearSetId;
  readonly name: string;
  /** One per piece, filled for the ones worn. */
  readonly pips: readonly SetPip[];
  readonly worn: number;
  /** The count that completes the set. */
  readonly completeAt: number;
  readonly complete: boolean;
  /** The bonuses switched on now. */
  readonly active: readonly GearSetBonus[];
}

/** Where `equipped` stands on `set`, for the detail pane's pips. */
export function setProgress(equipped: ReadonlyArray<ItemId>, set: GearSetId): SetProgress {
  const pips = setPieceIds(set).map((id) => ({ id, worn: equipped.includes(id) }));
  const worn = pips.filter((pip) => pip.worn).length;
  const completeAt = setCompletionPieces(set);
  return {
    set,
    name: GEAR_SETS[set].name,
    pips,
    worn,
    completeAt,
    complete: worn >= completeAt,
    active: activeSetBonuses(set, worn),
  };
}

/** The rarest piece of `set`, whose colour its completion shimmers in. */
export function setRarity(set: GearSetId): Rarity {
  let rarest: Rarity | null = null;
  for (const id of setPieceIds(set)) {
    const rarity = ITEM_DEF[id].rarity;
    if (rarity === undefined) continue;
    if (rarest === null || rarityRank(rarity) > rarityRank(rarest)) rarest = rarity;
  }
  return rarest ?? 'Common';
}

/** Where `wearer` stands on `set`, read off what she has equipped. */
export function crawlerSetProgress(wearer: Pick<Player, 'inventory'>, set: GearSetId): SetProgress {
  return setProgress([...wearer.inventory.equipment.equippedIds()], set);
}
