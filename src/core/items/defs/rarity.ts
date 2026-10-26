/**
 * The one rarity ladder, lowest to highest, shared by reward chests and gear.
 * Order matters: `rarityRank` and `rarityAtLeast` read it.
 */
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Divine'] as const;

export type Rarity = (typeof RARITIES)[number];

export function isRarity(value: unknown): value is Rarity {
  return RARITIES.some((rarity) => rarity === value);
}

/** 0 for Common up to 5 for Divine. */
export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

/** True when `rarity` is `floor` or higher on the ladder. */
export function rarityAtLeast(rarity: Rarity, floor: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(floor);
}
