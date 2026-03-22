export type ItemId =
  | 'health_potion'
  | 'enchanted_bigboi_boxers'
  | 'trollskin_shirt'
  | 'enchanted_crown_sepsis_whore'
  | 'scroll_of_confusing_fog'
  | 'goblin_dynamite'
  | 'gym_dumbbell'
  | 'gym_bench_press'
  | 'gym_treadmill'
  | 'quest_wood_board';

export type EquipSlot = 'Head' | 'Torso' | 'Legs' | 'Feet' | 'Hands';

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion, ability) may be placed in the hotbar. */
  canHotlist: boolean;
  type?: 'consumable' | 'armor';
  equipSlot?: EquipSlot;
  equipSubSlot?: string;
  description?: string;
  statBonus?: {
    constitution?: number;
    strength?: number;
    intelligence?: number;
  };
  /** References an active ability this item grants when equipped. */
  abilityId?: string;
  /** When true, hotbar slot renders with a lighter quest-item colour. */
  isQuestItem?: boolean;
}

export const ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>> = {
  scroll_of_confusing_fog: {
    id: 'scroll_of_confusing_fog',
    name: 'Scroll of Confusing Fog',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'Summons a thick fog cloud around the caster. Any enemy caught inside the fog loses all sense of sight and cannot target any entity. Lasts INT × 5 seconds.',
  },
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
  },
  goblin_dynamite: {
    id: 'goblin_dynamite',
    name: 'Goblin Dynamite',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A hissing stick of goblin-made dynamite. Only the Human can throw it. ' +
      'Hold the hotbar key to charge your throw — release to hurl it. ' +
      'Tap it to drop it at your feet. Warning: holding too long has consequences.',
  },
  gym_dumbbell: {
    id: 'gym_dumbbell',
    name: 'Dumbbell',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A heavy iron dumbbell. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_bench_press: {
    id: 'gym_bench_press',
    name: 'Bench Press',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A full bench press machine. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_treadmill: {
    id: 'gym_treadmill',
    name: 'Treadmill',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A sturdy treadmill. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  trollskin_shirt: {
    id: 'trollskin_shirt',
    name: 'Enchanted Trollskin Shirt of Pummeling',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { constitution: 3 },
    description:
      'The wearer of this shirt gains +7 to the Regeneration skill. In addition, ' +
      'all melee-based damage debuffs such as Stun, Knockback, Disarm, and ' +
      'Out-of-Breath are negated.',
  },
  enchanted_crown_sepsis_whore: {
    id: 'enchanted_crown_sepsis_whore',
    name: 'Enchanted Crown of the Sepsis Whore',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { intelligence: 5 },
    description:
      'Imbues the wearer with +5 Intelligence. All attacks, including ' +
      'magical attacks, now have a 15% chance to inflict the Sepsis debuff. ' +
      'Sepsis is a health-sapping curse that slowly drains the life of its ' +
      'victim until they perish.',
  },
  quest_wood_board: {
    id: 'quest_wood_board',
    name: 'Boards of Wood',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    isQuestItem: true,
    description:
      'Wooden boards scavenged from the wood pile. Place near floor grates to build ' +
      'barriers against Bugaboos. Only the Human can build or repair. Costs 4 boards.',
  },
  enchanted_bigboi_boxers: {
    id: 'enchanted_bigboi_boxers',
    name: 'Enchanted BigBoi Boxers',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Legs',
    equipSubSlot: 'Pants',
    statBonus: { constitution: 2 },
    abilityId: 'protective_shell',
    description:
      'Have you ever read an Incredible Hulk comic and thought to yourself, ' +
      'everything rips off of his body except his pants? No way. Well, spoiler alert. ' +
      "You're not wrong. Size-altering and were-creatures, such as the BigBoi are " +
      'required to wear enchanted, self-sizing items lest they wish to turn the dungeon ' +
      'into a nudist colony when they transform. That means everything they wear requires ' +
      'an enchantment. Everything, including their naughty little undies.',
  },
};

export const SLOT_COUNT = 32;
export const HOTBAR_COUNT = 8;
export const SLOTS_PER_PAGE = 16; // 4 × 4 grid
/** Last hotbar slot index, reserved for quest items. */
export const QUEST_SLOT_IDX = HOTBAR_COUNT - 1; // slot 7

/** Sub-slots available in each equipment slot. */
export const EQUIP_SUBSLOTS: Record<EquipSlot, string[]> = {
  Head: ['Hat', 'Face', 'Neck'],
  Torso: ['Shirt', 'Jacket', 'Back'],
  Legs: ['Pants', 'Knee Pads'],
  Hands: ['Gloves', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4'],
  Feet: ['Shoes', 'Toe Ring 1', 'Toe Ring 2', 'Toe Ring 3', 'Toe Ring 4'],
};
